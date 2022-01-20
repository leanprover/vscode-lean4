import { Disposable, OutputChannel, workspace, TextDocument, commands, window, EventEmitter, Uri, languages } from 'vscode';
import { LocalStorageService} from './localStorage'
import { LeanInstaller, LeanVersion } from './leanInstaller'
import { LeanClient } from '../leanclient'
import { LeanFileProgressProcessingInfo, RpcConnectParams, RpcKeepAliveParams } from '@lean4/infoview-api';

// This class ensures we have one LeanClient per workspace folder.
export class LeanClientProvider implements Disposable {
    private subscriptions: Disposable[] = [];
    private localStorage: LocalStorageService;
    private outputChannel: OutputChannel;
    private installer : LeanInstaller;
    private versions: Map<string, string> = new Map();
    private clients: Map<string, LeanClient> = new Map();
    private pending: Map<string, boolean> = new Map();
    private testing: Map<string, boolean> = new Map();
    private activeClient: LeanClient = null;

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    private activeClientChangedEmitter = new EventEmitter<LeanClient>()
    activeClientChanged = this.activeClientChangedEmitter.event

    constructor(localStorage : LocalStorageService, installer : LeanInstaller, outputChannel : OutputChannel) {
        this.localStorage = localStorage;
        this.outputChannel = outputChannel;
        this.installer = installer;

        workspace.onDidOpenTextDocument((d) => this.didOpenTextDocument(d));
        // this is resulting in duplicate calls.
        // workspace.textDocuments.forEach((d) => this.didOpenTextDocument(d));

        this.subscriptions.push(
            commands.registerCommand('lean4.refreshFileDependencies', () => this.refreshFileDependencies()),
            commands.registerCommand('lean4.restartServer', () => this.restartActiveClient())
        );

        workspace.onDidChangeWorkspaceFolders((event) => {
            for (const folder of event.removed) {
                const path = folder.uri.toString();
                const client = this.clients.get(path);
                if (client) {
                    this.clients.delete(path);
                    void client.stop();
                }
            }
        });

        installer.installChanged(async (uri: Uri | undefined) => {
            const path = uri?.toString()
            if (path in this.testing) return;
            // avoid re-entrancy since testLeanVersion can take a while.
            this.testing[path] = true;
            try {
                // have to check again here in case elan install had --default-toolchain none.
                const version = await installer.testLeanVersion(uri);
                if (version.version === '4' && this.clients.has(path)) {
                    const client = this.clients.get(path)
                    void client.restart()
                }
            } catch {
            }
            this.testing.delete(path);
        });

    }

    private refreshFileDependencies() {
        this.activeClient.refreshFileDependencies(window.activeTextEditor.document);
    }

    private restartActiveClient() {
        void this.activeClient?.restart();
    }

    didOpenTextDocument(document: TextDocument) {
        if (document.languageId === 'lean') {
            void languages.setTextDocumentLanguage(document, 'lean4');
        }

        void this.ensureClient(document, null);
    }

    getClient(uri: Uri){
        return this.clients.get(uri.toString());
    }

    getClients() : LeanClient[]{
        return Array.from(this.clients.values());
    }

    async ensureClient(doc: TextDocument, versionInfo: LeanVersion | null) {
        let folder = workspace.getWorkspaceFolder(doc.uri);
        if (!folder && doc.uri.fsPath) {
            // hmmm, why is vscode not giving us a workspace folder when new workspace is just opened???
            workspace.workspaceFolders.forEach((f) => {
                if (f.uri.fsPath && doc.uri.fsPath.startsWith(f.uri.fsPath)) {
                    folder = f;
                }
            });
        }
        if (!folder) {
            // If we can't find a folder then we can't start a LeanClient for it.
            return;
        }

        const folderUri = folder?.uri;
        const path = folderUri?.toString();
        let  client: LeanClient = null;
        if (this.clients.has(path)) {
            // we're good then
            client = this.clients.get(path);
        } else if (!this.versions.has(path) && !this.pending.has(path)) {
            this.pending.set(path, true);
            console.log('Creating LeanClient for ' + path);
            if (!versionInfo) {
                // TODO: what is the uri for untitled documents?  Hopefully they get their own special
                // LeanClient with some default version...
                versionInfo = await this.installer.testLeanVersion(folderUri);
            }
            this.versions.set(path, versionInfo.version);
            if (versionInfo.version && versionInfo.version !== '4') {
                // ignore workspaces that belong to a different version of Lean.
                console.log(`Lean4 extension ignoring workspace '${folderUri}' because it is not a Lean 4 workspace.`);
                this.pending.delete(path);
                return;
            }

            client = new LeanClient(folder, this.localStorage, this.outputChannel);
            this.subscriptions.push(client);
            this.clients.set(path, client);
            client.serverFailed((err) => window.showErrorMessage(err));

            // aggregate progress changed events.
            client.progressChanged(arg => {
                this.progressChangedEmitter.fire(arg);
            });

            if (!versionInfo.error) {
                // we are ready to start, otherwise some sort of install might be happening
                // as a result of UI options shown by testLeanVersion.
                void client.start();
            }

            this.pending.delete(path);
        }

        // tell the InfoView about this activated client.
        this.activeClient = client;
        this.activeClientChangedEmitter.fire(client);
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

}
