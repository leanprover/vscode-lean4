import { Disposable, OutputChannel, workspace, TextDocument, commands, window, EventEmitter, Uri, languages } from 'vscode';
import { LocalStorageService} from './localStorage'
import { LeanInstaller } from './leanInstaller'
import { LeanClient } from '../leanClient'
import { LeanFileProgressProcessingInfo } from '@lean4/infoview-api';

// This class ensures we have one LeanClient per workspace folder.
export class LeanClientProvider implements Disposable {
    private subscriptions: Disposable[] = [];
    private localStorage: LocalStorageService;
    private outputChannel: OutputChannel;
    private installer : LeanInstaller;
    private versions: Map<string, string> = new Map();
    private clients: Map<string, LeanClient> = new Map();
    private testing: Map<string, boolean> = new Map();

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    constructor(localStorage : LocalStorageService, installer : LeanInstaller, outputChannel : OutputChannel) {
        this.localStorage = localStorage;
        this.outputChannel = outputChannel;
        this.installer = installer;

        workspace.onDidOpenTextDocument((d) => this.didOpenTextDocument(d));
        // this is resulting in duplicate calls.
        // workspace.textDocuments.forEach((d) => this.didOpenTextDocument(d));

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

        installer.installChanged(async (uri: Uri) => {
            const path = uri.toString()
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

    didOpenTextDocument(document: TextDocument) {
        if (document.languageId === 'lean') {
            void languages.setTextDocumentLanguage(document, 'lean4');
        }

        void this.ensureClient(document);
    }

    async ensureClient(doc: TextDocument) {
        console.log('ensuring we have a client for ' + doc.uri.toString());
        let folder = workspace.getWorkspaceFolder(doc.uri);
        if (!folder && doc.uri.fsPath) {
            // hmmm, why is vscode not giving us a workspace folder when new workspace is just opened???
            workspace.workspaceFolders.forEach((f) => {
                if (f.uri.fsPath && doc.uri.fsPath.startsWith(f.uri.fsPath)) {
                    folder = f;
                }
            });
        }
        const folderUri = folder ? folder.uri : null;
        const path = folderUri ? folderUri.toString() : null;
        if (this.versions.has(path)) {
            // we're good then
        } else {
            // TODO: what is the uri for untitled documents?  Hopefully they get their own special
            // LeanClient with some default version...
            const versionInfo = await this.installer.testLeanVersion(folderUri);
            this.versions.set(path, versionInfo.version);
            if (versionInfo.version && versionInfo.version !== '4') {
                // ignore workspaces that belong to a different version of Lean.
                return;
            }

            const client: LeanClient = new LeanClient(folderUri, this.localStorage, this.outputChannel);
            this.subscriptions.push(client);
            this.clients.set(path, client);
            client.serverFailed((err) => window.showErrorMessage(err));
            this.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
                client.refreshFileDependencies(doc)
            }))
            this.subscriptions.push(commands.registerCommand('lean4.restartServer', () => client.restart()));

            // aggregate progress changed events.
            client.progressChanged(arg => {
                this.progressChangedEmitter.fire(arg);
            });

            if (!versionInfo.error) {
                // we are ready to start, otherwise some sort of install might be happening
                // as a result of UI options shown by testLeanVersion.
                void client.start();
            }

        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

}
