import { Disposable, OutputChannel, workspace, TextDocument, commands, window, EventEmitter, Uri, languages, TextEditor } from 'vscode';
import { LocalStorageService} from './localStorage'
import { LeanInstaller, LeanVersion } from './leanInstaller'
import { LeanpkgService } from './leanpkg';
import { LeanClient } from '../leanclient'
import { LeanFileProgressProcessingInfo, RpcConnectParams, RpcKeepAliveParams } from '@leanprover/infoview-api';
import * as path from 'path';
import { findLeanPackageRoot } from './projectInfo';
import { isFileInFolder } from './fsHelper';
import { logger } from './logger'
import { addDefaultElanPath, getDefaultElanPath, addToolchainBinPath, isElanDisabled, isRunningTest } from '../config'

// This class ensures we have one LeanClient per workspace folder.
export class LeanClientProvider implements Disposable {
    private subscriptions: Disposable[] = [];
    private localStorage: LocalStorageService;
    private outputChannel: OutputChannel;
    private installer : LeanInstaller;
    private pkgService : LeanpkgService;
    private versions: Map<string, LeanVersion> = new Map();
    private clients: Map<string, LeanClient> = new Map();
    private pending: Map<string, boolean> = new Map();
    private testing: Map<string, boolean> = new Map();
    private activeClient: LeanClient | undefined = undefined;

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    private clientAddedEmitter = new EventEmitter<LeanClient>()
    clientAdded = this.clientAddedEmitter.event

    private clientRemovedEmitter = new EventEmitter<LeanClient>()
    clientRemoved = this.clientRemovedEmitter.event

    private clientStoppedEmitter = new EventEmitter<[LeanClient, boolean, string]>()
    clientStopped = this.clientStoppedEmitter.event

    constructor(localStorage : LocalStorageService, installer : LeanInstaller, pkgService : LeanpkgService, outputChannel : OutputChannel) {
        this.localStorage = localStorage;
        this.outputChannel = outputChannel;
        this.installer = installer;
        this.pkgService = pkgService;

        // we must setup the installChanged event handler first before any didOpenEditor calls.
        installer.installChanged(async (uri: Uri) => await this.onInstallChanged(uri));
        installer.promptingInstall(async (uri: Uri) => await this.onPromptingInstall(uri));
        // Only change the document language for *visible* documents,
        // because this closes and then reopens the document.
        window.visibleTextEditors.forEach((e) => this.didOpenEditor(e.document));
        this.subscriptions.push(window.onDidChangeVisibleTextEditors((es) =>
            es.forEach((e) => this.didOpenEditor(e.document))));

        this.subscriptions.push(
            commands.registerCommand('lean4.restartFile', () => this.restartFile()),
            commands.registerCommand('lean4.refreshFileDependencies', () => this.restartFile()),
            commands.registerCommand('lean4.restartServer', () => this.restartActiveClient())
        );

        workspace.onDidOpenTextDocument((document) => this.didOpenEditor(document));

        workspace.onDidChangeWorkspaceFolders((event) => {
            for (const folder of event.removed) {
                const key = this.getKeyFromUri(folder.uri);
                const client = this.clients.get(key);
                if (client) {
                    logger.log(`[ClientProvider] onDidChangeWorkspaceFolders removing client for ${key}`);
                    this.clients.delete(key);
                    this.versions.delete(key);
                    client.dispose();
                    this.clientRemovedEmitter.fire(client);
                }
            }
        });
    }

    getActiveClient() : LeanClient | undefined {
        return this.activeClient;
    }

    private async onInstallChanged(uri: Uri){
        // This Uri could be 'undefined' in the case of a selectToolChain "reset"
        // Or it could be a package Uri in the case a lean package file was changed
        // or it could be a document Uri in the case of a command from
        // selectToolchainForActiveEditor.
        logger.log(`[clientProvider] installChanged for ${uri}`);
        const key = this.getKeyFromUri(uri);
        const path = uri.toString();
        if (this.testing.has(key)) {
            logger.log(`Blocking re-entrancy on ${path}`);
            return;
        }
        // avoid re-entrancy since testLeanVersion can take a while.
        this.testing.set(key, true);
        try {
            // have to check again here in case elan install had --default-toolchain none.
            const [workspaceFolder, folder, packageFileUri] = await findLeanPackageRoot(uri);
            const packageUri = folder ? folder : Uri.from({scheme: 'untitled'});
            logger.log('[clientProvider] testLeanVersion');
            const version = await this.installer.testLeanVersion(packageUri);
            if (version.version === '4') {
                logger.log('[clientProvider] got lean version 4');
                const [cached, client] = await this.ensureClient(uri, version);
                if (cached && client) {
                    await client.restart();
                }
            } else if (version.error) {
                logger.log(`[clientProvider] Lean version not ok: ${version.error}`);
            }
        } catch (e) {
            logger.log(`[clientProvider] Exception checking lean version: ${e}`);
        }
        this.testing.delete(key);
    }

    private async onPromptingInstall(uri: Uri) : Promise<void> {
        if (isRunningTest()){
            // no prompt, just do it!
            logger.log('Installing Lean via Elan during testing')
            await this.installer.installElan();
            if (isElanDisabled()) {
                addToolchainBinPath(getDefaultElanPath());
            } else {
                addDefaultElanPath();
            }
            await this.onInstallChanged(uri);
        }

    }
    private getVisibleEditor(uri: Uri) : TextEditor | null {
        const path = uri.toString();
        for (const editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === path){
                return editor;
            }
        }
        return null;
    }

    private restartFile() {
        if (window.activeTextEditor && this.activeClient) {
            void this.activeClient.restartFile(window.activeTextEditor.document);
        }
    }

    private restartActiveClient() {
        void this.activeClient?.restart();
    }

    clientIsStarted() {
        void this.activeClient?.isStarted();
    }

    async didOpenEditor(document: TextDocument) {
        this.pkgService.didOpen(document.uri);

        // bail as quickly as possible on non-lean files.
        if (document.languageId !== 'lean' && document.languageId !== 'lean4') {
            return;
        }

        if (!this.getVisibleEditor(document.uri)) {
            // Sometimes VS code opens a document that has no editor yet.
            // For example, this happens when the vs code opens files to get git
            // information using a "git:" Uri scheme:
            //  git:/d%3A/Temp/lean_examples/Foo/Foo/Hello.lean.git?%7B%22path%22%3A%22d%3A%5C%5CTemp%5C%5Clean_examples%5C%5CFoo%5C%5CFoo%5C%5CHello.lean%22%2C%22ref%22%3A%22%22%7D
            return;
        }

        // All open .lean files are assumed to be Lean 4 files.
        // We need to do this because by default, .lean is associated with language id `lean`,
        // i.e. Lean 3. vscode-lean is expected to yield when isLean4Project is true.
        if (document.languageId === 'lean') {
            // Only change the document language for *visible* documents,
            // because this closes and then reopens the document.
            await languages.setTextDocumentLanguage(document, 'lean4');

            // setTextDocumentLanguage triggers another didOpenEditor event,
            // and we want that event callback to be the one that calls
            // ensureClient, so we bail here so we don't try and do it twice
            // on the same document.
            return;
        }

        try {
            const [cached, client] = await this.ensureClient(document.uri, undefined);
            if (client) {
                await client.openLean4Document(document)
            }
        } catch (e) {
            logger.log(`### Error opening document: ${e}`);
        }
    }

    // Find the client for a given document.
    findClient(path: string){
        if (path) {
            for (const client of this.getClients()) {
                const folder = client.getWorkspaceFolder()
                if (isFileInFolder(path, folder))
                    return client
            }
        }
        return null
    }

    getClients() : LeanClient[]{
        return Array.from(this.clients.values());
    }

    // Return a string that can be used as a key in the clients, versions, testing, and pending
    // maps.  This is not just uri.toString() because on some platforms the file system is
    // case insensitive.
    getKeyFromUri(uri: Uri | null) : string{
        const uriNonNull = uri ?? Uri.from({scheme: 'untitled'});
        const path = uriNonNull.toString();
        if (uriNonNull.scheme === 'file' && process.platform === 'win32') {
            return path.toLowerCase();
        }
        return path;
    }

    getClientForFolder(folder: Uri) : LeanClient | undefined {
        let  client: LeanClient | undefined;
        const key = this.getKeyFromUri(folder);
        const cachedClient = this.clients.has(key);
        if (cachedClient) {
            // we're good then
            client = this.clients.get(key);
        }
        return client;
    }

    getFolderFromUri(uri: Uri) : Uri | null {
        if (uri){
            if (uri.scheme === 'untitled'){
                // this lean client can handle all untitled documents.
                return Uri.from({scheme: 'untitled'});
            }
            return uri.with({ path: path.posix.dirname(uri.path) });
        }
        return null;
    }

    async getLeanVersion(uri: Uri) : Promise<LeanVersion | undefined> {
        const [workspaceFolder, folder, packageFileUri] = await findLeanPackageRoot(uri);
        const folderUri = folder ?? Uri.from({scheme: 'untitled'});
        const key = this.getKeyFromUri(folderUri);
        if (this.versions.has(key)){
            return this.versions.get(key);
        }
        const versionInfo = await this.installer.testLeanVersion(folderUri);
        if (!versionInfo.error){
            this.versions.set(key, versionInfo);
        }
        return versionInfo;
    }

    // Starts a LeanClient if the given file is in a new workspace we haven't seen before.
    // Returns a boolean "true" if the LeanClient was already created.
    // Returns a null client if it turns out the new workspace is a lean3 workspace.
    async ensureClient(uri : Uri, versionInfo: LeanVersion | undefined) : Promise<[boolean,LeanClient | undefined]> {
        const [workspaceFolder, folder, packageFileUri] = await findLeanPackageRoot(uri);
        const folderUri = folder ? folder : Uri.from({scheme: 'untitled'});
        let client = this.getClientForFolder(folderUri);
        const key = this.getKeyFromUri(folder);
        const cachedClient = (client !== undefined);
        if (!client) {
            if (this.pending.has(key)) {
                logger.log('[ClientProvider] ignoring ensureClient already pending on ' + folderUri.toString());
                return [cachedClient, client];
            }

            this.pending.set(key, true);
            logger.log('[ClientProvider] Creating LeanClient for ' + folderUri.toString());

            // We must create a Client before doing the long running testLeanVersion
            // so that ensureClient callers have an "optimistic" client to work with.
            // This is needed in our constructor where it is calling ensureClient for
            // every open file.  A workspace could have multiple files open and we want
            // to remember all those open files are associated with this client before
            // testLeanVersion has completed.
            client = new LeanClient(workspaceFolder, folderUri, this.localStorage, this.outputChannel);
            this.subscriptions.push(client);
            this.clients.set(key, client);

            if (!versionInfo) {
                versionInfo = await this.getLeanVersion(folderUri);
            }
            if (versionInfo && versionInfo.version && versionInfo.version !== '4') {
                // ignore workspaces that belong to a different version of Lean.
                logger.log(`[ClientProvider] Lean4 extension ignoring workspace '${folderUri}' because it is not a Lean 4 workspace.`);
                this.pending.delete(key);
                this.clients.delete(key);
                client.dispose();
                return [false, undefined];
            }

            client.serverFailed((err) => {
                // forget this client!
                logger.log(`[ClientProvider] serverFailed, removing client for ${key}`);
                const cached = this.clients.get(key);
                this.clients.delete(key);
                cached?.dispose();
                void window.showErrorMessage(err);
            });

            client.stopped(err => {
                if (client) {
                    // fires a message in case a client is stopped unexpectedly
                    this.clientStoppedEmitter.fire([client, client === this.activeClient, err]);
                }
            });

            // aggregate progress changed events.
            client.progressChanged(arg => {
                this.progressChangedEmitter.fire(arg);
            });

            this.pending.delete(key);
            logger.log('[ClientProvider] firing clientAddedEmitter event');
            this.clientAddedEmitter.fire(client);

            if (versionInfo && !versionInfo.error) {
                // we are ready to start, otherwise some sort of install might be happening
                // as a result of UI options shown by testLeanVersion.
                await client.start();
            }
        }

        // tell the InfoView about this activated client.
        this.activeClient = client;

        return [cachedClient, client];
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
