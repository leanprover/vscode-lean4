import { TextDocument, EventEmitter, Diagnostic,
    languages, DocumentHighlight, Range, DocumentHighlightKind, window, workspace,
    Disposable, Uri, ConfigurationChangeEvent, OutputChannel, DiagnosticCollection,
    Position, WorkspaceFolder } from 'vscode'
import {
    Code2ProtocolConverter,
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    DidOpenTextDocumentNotification,
    DocumentFilter,
    InitializeResult,
    LanguageClient,
    LanguageClientOptions,
    Protocol2CodeConverter,
    PublishDiagnosticsParams,
    ServerOptions,
    State
} from 'vscode-languageclient/node'
import * as ls from 'vscode-languageserver-protocol'
import { toolchainPath, addServerEnvPaths, serverArgs, serverLoggingEnabled, serverLoggingPath, getElaborationDelay, lakeEnabled } from './config'
import { assert } from './utils/assert'
import { LeanFileProgressParams, LeanFileProgressProcessingInfo } from '@lean4/infoview-api';
import { LocalStorageService} from './utils/localStorage'
import { batchExecute, testExecute } from './utils/batch'
import { readLeanVersion } from './utils/projectInfo';
import { cwd } from 'process'
import * as fs from 'fs';
import { URL } from 'url';
import { join } from 'path';
 // @ts-ignore
import { SemVer } from 'semver';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Lean4Diagnostic extends ls.Diagnostic {
    fullRange: ls.Range;
}

export type ServerProgress = Map<Uri, LeanFileProgressProcessingInfo[]>;

export function getFullRange(diag: Diagnostic): Range {
    return (diag as any)?.fullRange || diag.range;
}

export class LeanClient implements Disposable {
    running: boolean
	private client: LanguageClient | undefined
    private toolchainPath: string
    private outputChannel: OutputChannel;
    private storageManager : LocalStorageService;
    private workspaceFolder: WorkspaceFolder | undefined;
    private folderUri: Uri;
    private subscriptions: Disposable[] = []

    private didChangeEmitter = new EventEmitter<DidChangeTextDocumentParams>()
    didChange = this.didChangeEmitter.event

    private diagnosticsEmitter = new EventEmitter<PublishDiagnosticsParams>()
    diagnostics = this.diagnosticsEmitter.event

    private didSetLanguageEmitter = new EventEmitter<string>();
    didSetLanguage = this.didSetLanguageEmitter.event

    private didCloseEmitter = new EventEmitter<DidCloseTextDocumentParams>();
    didClose = this.didCloseEmitter.event

    private customNotificationEmitter = new EventEmitter<{method: string, params: any}>();
    /** Fires whenever a custom notification (i.e. one not defined in LSP) is received. */
    customNotification = this.customNotificationEmitter.event;

    /** saved progress info in case infoview is opened, it needs to get all of it. */
    progress: ServerProgress = new Map()

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    private stoppedEmitter = new EventEmitter()
    stopped = this.stoppedEmitter.event

    private restartedEmitter = new EventEmitter()
    restarted = this.restartedEmitter.event

    private restartingEmitter = new EventEmitter()
    restarting = this.restartingEmitter.event

    private serverFailedEmitter = new EventEmitter<string>();
    serverFailed = this.serverFailedEmitter.event

    /** Files which are open. */
    private isOpen: Map<string, TextDocument> = new Map()

    constructor(workspaceFolder: WorkspaceFolder | undefined, folderUri: Uri, storageManager : LocalStorageService, outputChannel : OutputChannel) {
        this.storageManager = storageManager;
        this.outputChannel = outputChannel;
        this.workspaceFolder = workspaceFolder; // can be null when opening adhoc files.
        this.folderUri = folderUri;
        this.subscriptions.push(workspace.onDidChangeConfiguration((e) => this.configChanged(e)));
    }

    dispose(): void {
        this.subscriptions.forEach((s) => s.dispose())
        if (this.isStarted()) void this.stop()
    }

    async restart(): Promise<void> {
        const startTime = Date.now()

        if (this.isStarted()) {
            await this.stop()
        }

        this.restartingEmitter.fire(undefined)
        this.toolchainPath = this.storageManager.getLeanPath();
        if (!this.toolchainPath) this.toolchainPath = toolchainPath();
        const version = this.storageManager.getLeanVersion();
        const env = addServerEnvPaths(process.env);
        if (serverLoggingEnabled()) {
            env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
        }

        let executable = (this.toolchainPath) ? join(this.toolchainPath, 'bin', 'lake') : 'lake';

        // check if the lake process will start (skip it on scheme: 'untitled' files)
        let useLake = lakeEnabled() && this.folderUri && this.folderUri.scheme === 'file';
        if (useLake) {
            let knownDate = false;
            const lakefile = Uri.joinPath(this.folderUri, 'lakefile.lean')
            if (!fs.existsSync(new URL(lakefile.toString()))) {
                useLake = false;
            }
            else {
                // see if we can avoid the more expensive checkLakeVersion call.
                const date = await this.checkToolchainVersion(this.folderUri);
                if (date){
                    // Feb 16 2022 is when the 3.1.0.pre was released.
                    useLake = date >= new Date(2022, 1, 16);
                    knownDate = true;
                }
                if (useLake && !knownDate){
                    useLake = await this.checkLakeVersion(executable, version);
                }
            }
        }

        if (!useLake) {
            executable = (this.toolchainPath) ? join(this.toolchainPath, 'bin', 'lean') : 'lean';
        }

        let options = version ? ['+' + version] :[]
        if (useLake) {
            options = options.concat(['serve', '--'])
        } else{
            options = options.concat(['--server'])
        }

        // Add folder name to command-line so that it shows up in `ps aux`.
        if (this.folderUri) {
            options.push('' + this.folderUri.fsPath)
        } else {
            options.push('untitled')
        }

        const serverOptions: ServerOptions = {
            command: executable,
            args: options.concat(serverArgs()),
            options: {
                shell: true,
                cwd: this.folderUri?.fsPath,
                env
            }
        }

        const documentSelector: DocumentFilter = {
            language: 'lean4'
        }

        if (this.folderUri){
            documentSelector.scheme = this.folderUri.scheme
            if (this.folderUri.scheme !== 'untitled') {
                documentSelector.pattern = `${this.folderUri.fsPath}/**/*`
            }
        }

        const clientOptions: LanguageClientOptions = {
            outputChannel: this.outputChannel,
            documentSelector: [documentSelector],
            workspaceFolder: this.workspaceFolder,
            initializationOptions: {
                editDelay: getElaborationDelay(), hasWidgets: true,
            },
            middleware: {
                handleDiagnostics: (uri, diagnostics, next) => {
                    next(uri, diagnostics);
                    if (!this.client) return;
                    const uri_ = this.client.code2ProtocolConverter.asUri(uri);
                    const diagnostics_ = [];
                    for (const d of diagnostics) {
                        const d_: ls.Diagnostic = {
                            ...this.client.code2ProtocolConverter.asDiagnostic(d),
                        };
                        diagnostics_.push(d_);
                    }
                    this.diagnosticsEmitter.fire({uri: uri_, diagnostics: diagnostics_});
                },

                didOpen: async () => {
                    // Note: as per the LSP spec: An open notification must not be sent more than once
                    // without a corresponding close notification send before. This means open and close
                    // notification must be balanced and the max open count for a particular textDocument
                    // is one.  So this even does nothing the notification is handled by the
                    // openLean4Document method below after the 'lean4' languageId is established and
                    // it has weeded out documents opened to invisible editors (like 'git:' schemes and
                    // invisible editors created for Ctrl+Hover events.  A side effect of unbalanced
                    // open/close notification is leaking 'lean --worker' processes.
                    // See https://github.com/microsoft/vscode/issues/78453).
                    return;
                },

                didChange: (data, next) => {
                    next(data);
                    if (!this.running || !this.client) return; // there was a problem starting lean server.
                    const params = this.client.code2ProtocolConverter.asChangeTextDocumentParams(data);
                    this.didChangeEmitter.fire(params);
                },

                didClose: (doc, next) => {
                    if (!this.isOpen.delete(doc.uri.toString())) return;
                    next(doc);
                    if (!this.running || !this.client) return; // there was a problem starting lean server.
                    const params = this.client.code2ProtocolConverter.asCloseTextDocumentParams(doc);
                    this.didCloseEmitter.fire(params);
                },

                provideDocumentHighlights: async (doc, pos, ctok, next) => {
                    const leanHighlights = await next(doc, pos, ctok);
                    if (leanHighlights?.length) return leanHighlights;

                    // vscode doesn't fall back to textual highlights,
                    // so we need to do that manually
                    await new Promise((res) => setTimeout(res, 250));
                    if (ctok.isCancellationRequested) return;

                    const wordRange = doc.getWordRangeAtPosition(pos);
                    if (!wordRange) return;
                    const word = doc.getText(wordRange);

                    const highlights: DocumentHighlight[] = [];
                    const text = doc.getText();
                    const nonWordPattern = '[`~@$%^&*()-=+\\[{\\]}⟨⟩⦃⦄⟦⟧⟮⟯‹›\\\\|;:\",./\\s]|^|$'
                    const regexp = new RegExp(`(?<=${nonWordPattern})${escapeRegExp(word)}(?=${nonWordPattern})`, 'g')
                    for (const match of text.matchAll(regexp)) {
                        const start = doc.positionAt(match.index ?? 0)
                        highlights.push({
                            range: new Range(start, start.translate(0, match[0].length)),
                            kind: DocumentHighlightKind.Text,
                        })
                    }

                    return highlights;
                }
            },
        }
        this.client = new LanguageClient(
            'lean4',
            'Lean 4',
            serverOptions,
            clientOptions
        )
        this.patchConverters(this.client.protocol2CodeConverter, this.client.code2ProtocolConverter)
        try {
            this.client.onDidChangeState((s) =>{
                // see https://github.com/microsoft/vscode-languageserver-node/issues/825
                if (s.newState === State.Starting) {
                    console.log('client starting');
                } else if (s.newState === State.Running) {
                    const end = Date.now()
                    console.log('client running, started in ', end - startTime, 'ms');
                    this.running = true; // may have been auto restarted after it failed.
                } else if (s.newState === State.Stopped) {
                    console.log('client has stopped or it failed to start');
                    this.running = false;
                }
            })
            this.client.start()
            await this.client.onReady();
            // tell the new client about the documents that are already open!
            for (const key of this.isOpen.keys()) {
                const doc = this.isOpen.get(key);
                if (doc) this.notifyDidOpen(doc);
            }
            // if we got this far then the client is happy so we are running!
            this.running = true;
        } catch (error) {
            this.outputChannel.appendLine('' + error);
            this.serverFailedEmitter.fire('' + error);
            return;
        }

        // HACK(WN): Register a default notification handler to fire on custom notifications.
        // There is an API for this in vscode-jsonrpc but not in vscode-languageclient, so we
        // hack around its implementation.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.client.onNotification({
            method: (method: string, params_: any) => {
                if (method === '$/lean/fileProgress' && this.client) {
                    const params = params_ as LeanFileProgressParams;
                    const uri = this.client.protocol2CodeConverter.asUri(params.textDocument.uri)
                    this.progressChangedEmitter.fire([uri.toString(), params.processing]);
                    // save the latest progress on this Uri in case infoview needs it later.
                    this.progress.set(uri, params.processing);
                }

                this.customNotificationEmitter.fire({method, params: params_});
            }
        } as any, ()=>{});

        // Reveal the standard error output channel when the server prints something to stderr.
        // The vscode-languageclient library already takes care of writing it to the output channel.
        (this.client as any)._serverProcess.stderr.on('data', () => {
            this.client?.outputChannel.show(true);
        });

        this.restartedEmitter.fire(undefined)
    }

    private patchConverters(p2c: Protocol2CodeConverter, c2p: Code2ProtocolConverter) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const oldAsDiagnostic = p2c.asDiagnostic
        p2c.asDiagnostic = function (protDiag: Lean4Diagnostic): Diagnostic {
            if (!protDiag.message) {
                // Fixes: Notification handler 'textDocument/publishDiagnostics' failed with message: message must be set
                protDiag.message = ' ';
            }
            const diag = oldAsDiagnostic.apply(this, [protDiag])
            diag.fullRange = p2c.asRange(protDiag.fullRange)
            return diag
        }
        p2c.asDiagnostics = (diags) => diags.map(d => p2c.asDiagnostic(d))

        // eslint-disable-next-line @typescript-eslint/unbound-method
        const c2pAsDiagnostic = c2p.asDiagnostic;
        c2p.asDiagnostic = function (diag: Diagnostic & {fullRange: Range}): Lean4Diagnostic {
            const protDiag = c2pAsDiagnostic.apply(this, [diag])
            protDiag.fullRange = c2p.asRange(diag.fullRange)
            return protDiag
        }
        c2p.asDiagnostics = (diags) => diags.map(d => c2p.asDiagnostic(d))
    }

    async openLean4Document(doc: TextDocument) {
        if (this.isOpen.has(doc.uri.toString())) return;
        if (!this.isSameWorkspace(doc.uri)){
            // skip it, this file belongs to a different workspace...
            return;
        }

        this.isOpen.set(doc.uri.toString(), doc)

        if (!this.running) return; // there was a problem starting lean server.

        // didOpenEditor may have also changed the language, so we fire the
        // event here because the InfoView should be wired up to receive it now.
        this.didSetLanguageEmitter.fire(doc.languageId);

        this.notifyDidOpen(doc);
    }

    notifyDidOpen(doc: TextDocument) {
        void this.client?.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: {
                uri: doc.uri.toString(),
                languageId: doc.languageId,
                version: 1,
                text: doc.getText(),
            },
        });
    }

    isSameWorkspace(uri: Uri){
        if (this.folderUri) {
            if (uri.toString().startsWith(this.folderUri.toString())) {
                // skip it, this file belongs to a different workspace...
                return true;
            }
        }
        else {
            return uri.scheme === 'untitled'
        }
        return false;
    }

    getWorkspaceFolder() : string {
        return this.folderUri?.toString();
    }

    start(): Promise<void> {
        return this.restart()
    }

    isStarted(): boolean {
        return this.client !== undefined
    }

    async stop(): Promise<void> {
        assert(() => this.isStarted())
        if (this.client && this.running) {
            this.stoppedEmitter.fire(undefined);
            await this.client.stop()
        }

        this.progress = new Map()
        this.client = undefined
        this.running = false
    }

    configChanged(e : ConfigurationChangeEvent): void {
        let newToolchainPath = this.storageManager.getLeanPath();
        if (!newToolchainPath) newToolchainPath = toolchainPath();
        if (this.toolchainPath !== newToolchainPath){
            void this.restart();
        }
    }

    refreshFileDependencies(doc: TextDocument): void {
        if (!this.running) return; // there was a problem starting lean server.
        assert(() => this.isStarted())

        if (!this.isSameWorkspace(doc.uri)){
            // skip it, this file belongs to a different workspace...
            return;
        }
        const uri = doc.uri.toString()
        // This causes a text document version number discontinuity. In
        // (didChange (oldVersion) => refreshFileDependencies => didChange (newVersion))
        // the client emits newVersion = oldVersion + 1, despite the fact that the
        // didOpen packet emitted below initializes the version number to be 1.
        // This is not a problem though, since both client and server are fine
        // as long as the version numbers are monotonous.
        void this.client?.sendNotification('textDocument/didClose', {
            'textDocument': {
                uri
            }
        })
        void this.client?.sendNotification('textDocument/didOpen', {
            'textDocument': {
                uri,
                'languageId': 'lean4',
                'version': 1,
                'text': doc.getText()
            }
        })
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    sendRequest(method: string, params: any) : Promise<any> {
        return this.running && this.client ? this.client.sendRequest(method, params) :
            new Promise<any>((_, reject)=>{ reject('Client is not running');});
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    sendNotification(method: string, params: any): void {
        return this.running  && this.client ? this.client.sendNotification(method, params) : undefined;
    }

    convertUri(uri: Uri): Uri {
        return this.running  && this.client ? Uri.parse(this.client.code2ProtocolConverter.asUri(uri)) : uri;
    }

    convertUriFromString(uri: string): Uri {
        const u = Uri.parse(uri);
        return this.running && this.client ? Uri.parse(this.client.code2ProtocolConverter.asUri(u)) : u;
    }

    convertPosition(pos: ls.Position) : Position | undefined {
        return this.running ? this.client?.protocol2CodeConverter.asPosition(pos) : undefined;
    }

    convertRange(range: ls.Range | undefined): Range | undefined {
        return this.running && range ? this.client?.protocol2CodeConverter.asRange(range) : undefined;
    }

    getDiagnosticParams(uri: Uri, diagnostics: readonly Diagnostic[]) : PublishDiagnosticsParams {
        const params: PublishDiagnosticsParams = {
            uri: this.convertUri(uri)?.toString(),
            diagnostics: this.client?.code2ProtocolConverter.asDiagnostics(diagnostics as Diagnostic[]) ?? []
        };
        return params;
    }

    getDiagnostics() : DiagnosticCollection | undefined {
        return this.running ? this.client?.diagnostics : undefined;
    }

    get initializeResult() : InitializeResult | undefined {
        return this.running ? this.client?.initializeResult : undefined
    }

    private async checkToolchainVersion(folderUri: Uri) : Promise<Date | undefined> {

        // see if we have a well known toolchain label that corresponds
        // to a known date like 'leanprover/lean4:nightly-2022-02-01'
        const toolchainVersion = await readLeanVersion(folderUri);
        if (toolchainVersion) {
            const match = /^leanprover\/lean4:nightly-(\d+)-(\d+)-(\d+)$/.exec(toolchainVersion);
            if (match) {
                return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            }
            if (toolchainVersion === 'leanprover/lean4:stable') {
                return new Date(2022, 2, 1);
            }
        }
        return undefined;
    }

    async checkLakeVersion(executable: string, version: string) : Promise<boolean> {
        // Check that the Lake version is high enough to support "lake serve" option.
        const versionOptions = version ? ['+' + version, '--version'] : ['--version']
        const start = Date.now()
        const lakeVersion = await batchExecute(executable, versionOptions, this.folderUri?.fsPath, undefined);
        console.log(`Ran '${executable} ${versionOptions.join(' ')}' in ${Date.now() - start} ms`);
        const actual = this.extractVersion(lakeVersion)
        if (actual.compare('3.0.0') > 0) {
            return true;
        }
        return false;
    }

    private extractVersion(v: string | undefined) : SemVer {
        if (!v) return new SemVer('0.0.0');
        const prefix = 'Lake version'
        if (v.startsWith(prefix)) v = v.slice(prefix.length).trim()
        const pos = v.indexOf('(')
        if (pos > 0) v = v.slice(0, pos).trim()
        try {
            return new SemVer(v)
        } catch {
            return new SemVer('0.0.0');
        }
    }
}
