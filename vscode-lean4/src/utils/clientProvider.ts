import { Disposable, OutputChannel, workspace, TextDocument, commands, window, EventEmitter, Uri, languages, TextEditor } from 'vscode';
import { LeanInstaller, LeanVersion } from './leanInstaller'
import { LeanClient } from '../leanclient'
import { LeanFileProgressProcessingInfo, ServerStoppedReason } from '@leanprover/infoview-api';
import * as path from 'path';
import { checkParentFoldersForLeanProject, findLeanPackageRoot, isValidLeanProject } from './projectInfo';
import { isFileInFolder } from './fsHelper';
import { logger } from './logger'
import { addDefaultElanPath, getDefaultElanPath, addToolchainBinPath, isElanDisabled, shouldShowInvalidProjectWarnings } from '../config'
import { displayErrorWithOutput } from './errors';
import { Diagnostic, DiagnosticSeverity, PublishDiagnosticsParams, integer } from 'vscode-languageclient';

interface PendingDiagnosticNotification {
    client: LeanClient
    uri: Uri
    version: integer
    diagnostic: Diagnostic
}

// This class ensures we have one LeanClient per workspace folder.
export class LeanClientProvider implements Disposable {
    private subscriptions: Disposable[] = [];
    private outputChannel: OutputChannel;
    private installer : LeanInstaller;
    private versions: Map<string, LeanVersion> = new Map();
    private clients: Map<string, LeanClient> = new Map();
    private pending: Map<string, boolean> = new Map();
    private pendingInstallChanged: Uri[] = [];
    private processingInstallChanged: boolean = false;
    private activeClient: LeanClient | undefined = undefined;
    /**
     * `Set<File Uri x Diagnostic Code x Diagnostic Data>` to avoid issuing multiple notifications
     * for the "same" (same uri, diagnostic code and data) diagnostic. The language server issues
     * diagnostics after every `didChange`, so we must ensure that we do not issue notifications
     * over and over again.
     */
    private notificationDiagnostics: Map<string, Map<string, Set<string | undefined>>> = new Map()
    /**
     * Notifications that will be discharged as soon as the file denoted by a key in the map is selected.
     */
    private pendingNotifications: Map<string, PendingDiagnosticNotification[]> = new Map()

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    private clientAddedEmitter = new EventEmitter<LeanClient>()
    clientAdded = this.clientAddedEmitter.event

    private clientRemovedEmitter = new EventEmitter<LeanClient>()
    clientRemoved = this.clientRemovedEmitter.event

    private clientStoppedEmitter = new EventEmitter<[LeanClient, boolean, ServerStoppedReason]>()
    clientStopped = this.clientStoppedEmitter.event

    constructor(installer: LeanInstaller, outputChannel: OutputChannel) {
        this.outputChannel = outputChannel;
        this.installer = installer;

        // we must setup the installChanged event handler first before any didOpenEditor calls.
        installer.installChanged(async (uri: Uri) => await this.onInstallChanged(uri));
        // Only change the document language for *visible* documents,
        // because this closes and then reopens the document.
        window.visibleTextEditors.forEach(e => this.didOpenEditor(e.document));
        this.subscriptions.push(window.onDidChangeVisibleTextEditors(es =>
            es.forEach(e => this.didOpenEditor(e.document))));

        this.subscriptions.push(
            commands.registerCommand('lean4.restartFile', () => this.restartFile()),
            commands.registerCommand('lean4.refreshFileDependencies', () => this.restartFile()),
            commands.registerCommand('lean4.restartServer', () => this.restartActiveClient()),
            commands.registerCommand('lean4.stopServer', () => this.stopActiveClient())
        );

        workspace.onDidOpenTextDocument(document => this.didOpenEditor(document));
        workspace.onDidCloseTextDocument(document => this.didCloseEditor(document.uri))

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
        // Uri is a package Uri in the case a lean package file was changed.
        logger.log(`[ClientProvider] installChanged for ${uri}`);
        this.pendingInstallChanged.push(uri);
        if (this.processingInstallChanged){
            // avoid re-entrancy.
            return;
        }
        this.processingInstallChanged = true;

        while (this.pendingInstallChanged.length > 0)
        {
            try {
                const uri = this.pendingInstallChanged.pop();
                if (uri) {
                    // have to check again here in case elan install had --default-toolchain none.
                    const [workspaceFolder, folder, packageFileUri] = await findLeanPackageRoot(uri);
                    const packageUri = folder ?? Uri.from({scheme: 'untitled'});
                    logger.log('[ClientProvider] testLeanVersion');
                    const version = await this.installer.testLeanVersion(packageUri);
                    if (version.version === '4') {
                        logger.log('[ClientProvider] got lean version 4');
                        const [cached, client] = await this.ensureClient(uri, version);
                        if (cached && client) {
                            await client.restart();
                            logger.log('[ClientProvider] restart complete');
                        }
                    } else if (version.error) {
                        logger.log(`[ClientProvider] Lean version not ok: ${version.error}`);
                    }
                }
            } catch (e) {
                logger.log(`[ClientProvider] Exception checking lean version: ${e}`);
            }
        }
        this.processingInstallChanged = false;
    }

    private async autoInstall() : Promise<void> {
        // no prompt, just do it!
        await this.installer.installElan();
        if (isElanDisabled()) {
            addToolchainBinPath(getDefaultElanPath());
        } else {
            addDefaultElanPath();
        }

        for (const [_, client] of this.clients) {
            await this.onInstallChanged(client.folderUri)
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
        if (!this.activeClient || !this.activeClient.isRunning()) {
            void window.showErrorMessage('No active client.')
            return
        }

        if (!window.activeTextEditor || window.activeTextEditor.document.languageId !== 'lean4') {
            void window.showErrorMessage('No active Lean editor tab. Make sure to focus the Lean editor tab for which you want to issue a restart.')
            return
        }

        void this.activeClient.restartFile(window.activeTextEditor.document);
    }

    private stopActiveClient() {
        if (this.activeClient && this.activeClient.isStarted()) {
            void this.activeClient?.stop();
        }
    }

    private async restartActiveClient() {
        void this.activeClient?.restart();
    }

    clientIsStarted() {
        void this.activeClient?.isStarted();
    }

    private async didCloseEditor(uri: Uri) {
        this.notificationDiagnostics.delete(uri.fsPath)
        this.pendingNotifications.delete(uri.fsPath)
    }

    async didOpenEditor(document: TextDocument) {
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
            if (!client) {
                return
            }

            await client.openLean4Document(document)

            await this.dischargePendingNotifications(document.uri)

            await this.checkIsValidProjectFolder(client.folderUri)
        } catch (e) {
            logger.log(`[ClientProvider] ### Error opening document: ${e}`);
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

    // Return a string that can be used as a key in the clients, versions, pendingInstallChanged, and pending
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
        let client: LeanClient | undefined;
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

    private async getLeanVersion(uri: Uri) : Promise<LeanVersion | undefined> {
        const [workspaceFolder, folder, packageFileUri] = await findLeanPackageRoot(uri);
        const folderUri = folder ?? Uri.from({scheme: 'untitled'});
        const key = this.getKeyFromUri(folderUri);
        if (this.versions.has(key)){
            return this.versions.get(key);
        }
        let versionInfo : LeanVersion | undefined = await this.installer.testLeanVersion(folderUri);
        if (!versionInfo.error){
            this.versions.set(key, versionInfo);
        } else if (versionInfo.error === 'no elan installed' || versionInfo.error === 'lean not found') {
            if (!this.installer.getPromptUser()){
                await this.autoInstall();
                versionInfo = await this.installer.testLeanVersion(folderUri);
                if (!versionInfo.error){
                    this.versions.set(key, versionInfo);
                }
            } else {
                // Ah, then we need to prompt the user, this waits for answer,
                // but does not wait for the install to complete.
                await this.installer.showInstallOptions(uri);
            }
        } else {
            void displayErrorWithOutput('Cannot determine Lean version: ' + versionInfo.error)
        }
        return versionInfo;
    }

    // Starts a LeanClient if the given file is in a new workspace we haven't seen before.
    // Returns a boolean "true" if the LeanClient was already created.
    // Returns a null client if it turns out the new workspace is a lean3 workspace.
    async ensureClient(uri : Uri, versionInfo: LeanVersion | undefined) : Promise<[boolean,LeanClient | undefined]> {
        const [workspaceFolder, folder, packageFileUri] = await findLeanPackageRoot(uri);
        const folderUri = folder ?? Uri.from({scheme: 'untitled'});
        let client = this.getClientForFolder(folderUri);
        const key = this.getKeyFromUri(folder);
        const cachedClient = (client !== undefined);
        if (!client) {
            if (this.pending.has(key)) {
                logger.log('[ClientProvider] ignoring ensureClient already pending on ' + folderUri.toString());
                return [cachedClient, client];
            }

            this.pending.set(key, true);
            if (!versionInfo) {
                // this can go all the way to installing elan (in the test scenario)
                // so it has to be done BEFORE we attempt to create any LeanClient.
                versionInfo = await this.getLeanVersion(folderUri);
            }

            logger.log('[ClientProvider] Creating LeanClient for ' + folderUri.toString());
            const elanDefaultToolchain = await this.installer.getElanDefaultToolchain(folderUri);

            // We must create a Client before doing the long running testLeanVersion
            // so that ensureClient callers have an "optimistic" client to work with.
            // This is needed in our constructor where it is calling ensureClient for
            // every open file.  A workspace could have multiple files open and we want
            // to remember all those open files are associated with this client before
            // testLeanVersion has completed.
            client = new LeanClient(workspaceFolder, folderUri, this.outputChannel, elanDefaultToolchain);
            this.subscriptions.push(client);
            this.clients.set(key, client);

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

            client.stopped(reason => {
                if (client) {
                    // fires a message in case a client is stopped unexpectedly
                    this.clientStoppedEmitter.fire([client, client === this.activeClient, reason]);
                }
            });

            // aggregate progress changed events.
            client.progressChanged(arg => {
                this.progressChangedEmitter.fire(arg);
            });

            client.diagnostics(async params => {
                if (!client) {
                    return
                }

                const fileUri = Uri.parse(params.uri)

                const doc: TextDocument | undefined = workspace.textDocuments.find(doc => doc.uri.fsPath === fileUri.fsPath)
                if (!doc) {
                    return
                }
                const version = doc.version

                for (const d of params.diagnostics) {
                    if (!this.isDiagnosticNotification(d)) {
                        continue
                    }

                    const n = {
                        client,
                        uri: fileUri,
                        version,
                        diagnostic: d
                    }

                    await this.addPendingDiagnosticNotification(n)
                }
            })

            client.restartedWorker(uri => this.didCloseEditor(Uri.parse(uri)))

            this.pending.delete(key);
            logger.log('[ClientProvider] firing clientAddedEmitter event');
            this.clientAddedEmitter.fire(client);

            if (versionInfo) {
                if (!versionInfo.error) {
                    // we are ready to start, otherwise some sort of install might be happening
                    // as a result of UI options shown by testLeanVersion.
                    await client.start();
                } else {
                    logger.log(`[ClientProvider] skipping client.start because of versionInfo error: ${versionInfo?.error}`);
                }
            }
        }

        // tell the InfoView about this activated client.
        this.activeClient = client;

        return [cachedClient, client];
    }

    private async checkIsValidProjectFolder(folderUri: Uri) {
        if (!shouldShowInvalidProjectWarnings()) {
            return
        }

        if (folderUri.scheme !== 'file') {
            void window.showWarningMessage('Lean 4 server operating in restricted single file mode. Please open a valid Lean 4 project containing a \'lean-toolchain\' file for full functionality.')
            return
        }

        if (await isValidLeanProject(folderUri)) {
            return
        }

        const parentProjectFolder: Uri | undefined = await checkParentFoldersForLeanProject(folderUri)
        if (parentProjectFolder === undefined) {
            void window.showWarningMessage('Opened folder is not a valid Lean 4 project. Please open a valid Lean 4 project containing a \'lean-toolchain\' file for full functionality.')
            return
        }

        const message = `Opened folder is not a valid Lean 4 project folder because it does not contain a 'lean-toolchain' file.
However, a valid Lean 4 project folder was found in one of the parent directories at '${parentProjectFolder.fsPath}'.
Open this project instead?`
        const input = 'Open parent directory project'
        const choice: string | undefined = await window.showWarningMessage(message, input)
        if (choice === input) {
            // this kills the extension host
            await commands.executeCommand('vscode.openFolder', parentProjectFolder)
        }
    }

    private async addPendingDiagnosticNotification(newPendingNotification: PendingDiagnosticNotification) {
        const uri = newPendingNotification.uri
        const pendingNotifications = this.pendingNotifications.get(uri.fsPath) ?? []
        pendingNotifications.push(newPendingNotification)
        this.pendingNotifications.set(uri.fsPath, pendingNotifications)

        // File is already open => immediately discharge notification
        if (window.visibleTextEditors.some(e => e.document.uri.fsPath === uri.fsPath)) {
            await this.dischargePendingNotifications(uri)
        }
    }

    private async dischargePendingNotifications(uri: Uri) {
        const pendingNotifications = this.pendingNotifications.get(uri.fsPath) ?? []
        this.pendingNotifications.delete(uri.fsPath)

        const importsOutdatedErrors = pendingNotifications.filter(n => this.isImportsOutdatedError(n.diagnostic))
        if (importsOutdatedErrors.length > 0) {
            void this.issueImportsOutdatedError(importsOutdatedErrors[0].client, uri)
        }

        const importOutdatedWarnings = pendingNotifications.filter(n => this.isImportOutdatedWarning(n.diagnostic))
        if (importOutdatedWarnings.length > 0) {
            let maxVersionWarning = importOutdatedWarnings[0]
            for (const importOutdatedWarning of importOutdatedWarnings) {
                if (importOutdatedWarning.version > maxVersionWarning.version) {
                    maxVersionWarning = importOutdatedWarning
                }
            }
            const code = maxVersionWarning.diagnostic.code as string // ensured by isImportOutdatedWarning
            const data = maxVersionWarning.diagnostic.data
            const isOldImportOutdatedWarning = this.isKnownNotificationDiagnostic(uri, code, data)
            if (!isOldImportOutdatedWarning) {
                this.addNotificationDiagnostic(uri, code, data)
                void this.issueImportOutdatedWarning(maxVersionWarning.client, uri, maxVersionWarning.diagnostic)
            }
        }

    }

    private isDiagnosticNotification(d: Diagnostic): boolean {
        return this.isImportOutdatedWarning(d) || this.isImportsOutdatedError(d)
    }

    private isImportOutdatedWarning(d: Diagnostic): boolean {
        return d.severity === DiagnosticSeverity.Warning && d.code === 'LanguageServer_ImportOutOfDate'
    }

    private isImportsOutdatedError(d: Diagnostic): boolean {
        return d.severity === DiagnosticSeverity.Error
            && d.message.includes('Imports are out of date and must be rebuilt')
            && d.range.start.line === 0
            && d.range.start.character === 0
            && d.range.end.line === 0
            && d.range.end.character === 0
    }

    private async issueImportsOutdatedError(client: LeanClient, fileUri: Uri) {
        const fileName = path.basename(fileUri.fsPath)
        const message = `Imports of '${fileName}' are out of date and must be rebuilt. Restarting the file will rebuild them.`
        const input = 'Restart File'
        const choice = await window.showInformationMessage(message, input)
        if (choice !== input) {
            return
        }

        const document = workspace.textDocuments.find(doc => doc.uri.fsPath === fileUri.fsPath)
        if (!document || document.isClosed) {
            void window.showErrorMessage(`'${fileName}' was closed in the meantime. Imports will not be rebuilt.`)
            return
        }

        await client.restartFile(document)
    }

    private async issueImportOutdatedWarning(client: LeanClient, fileUri: Uri, d: Diagnostic) {
        const fileName = path.basename(fileUri.fsPath)

        const message = `Import '${d.data}' of '${fileName}' is out of date. Restarting the file will update it.`
        const input = 'Restart File'
        const choice = await window.showInformationMessage(message, input)
        if (choice !== input) {
            return
        }

        const document = workspace.textDocuments.find(doc => doc.uri.fsPath === fileUri.fsPath)
        if (!document || document.isClosed) {
            void window.showErrorMessage(`'${fileName}' was closed in the meantime. File will not be restarted.`)
            return
        }

        await client.restartFile(document)
    }

    private isKnownNotificationDiagnostic(uri: Uri, code: string, data?: string | undefined): boolean {
        return this.notificationDiagnostics.get(uri.fsPath)?.get(code)?.has(data) ?? false
    }

    private addNotificationDiagnostic(uri: Uri, code: string, data?: string | undefined) {
        const map: Map<string, Set<string | undefined>> = this.notificationDiagnostics.get(uri.fsPath) ?? new Map()
        const set = map.get(code) ?? new Set()
        set.add(data)
        map.set(code, set)
        this.notificationDiagnostics.set(uri.fsPath, map)
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
