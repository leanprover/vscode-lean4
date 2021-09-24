import { TextDocument, Position, TextEditor, EventEmitter, Diagnostic,
    languages, DocumentHighlight, Range, DocumentHighlightKind, window, workspace,
    Disposable, Uri, TextEditorOptionsChangeEvent, ConfigurationChangeEvent } from 'vscode'
import {
    Code2ProtocolConverter,
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    DidOpenTextDocumentNotification,
    DocumentFilter,
    LanguageClient,
    LanguageClientOptions,
    Protocol2CodeConverter,
    PublishDiagnosticsParams,
    ServerOptions,
} from 'vscode-languageclient/node'
import * as ls from 'vscode-languageserver-protocol'
import { executablePath, addServerEnvPaths, serverArgs, serverLoggingEnabled, serverLoggingPath, getElaborationDelay } from './config'
import { assert } from './utils/assert'
import { PlainGoal, PlainTermGoal, LeanFileProgressParams, LeanFileProgressProcessingInfo } from '@lean4/infoview';
import { LocalStorageService} from './utils/localStorage'

const documentSelector: DocumentFilter = {
    scheme: 'file',
    language: 'lean4',
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Lean4Diagnostic extends ls.Diagnostic {
    fullRange: ls.Range;
}

export type ServerProgress = Map<Uri, LeanFileProgressProcessingInfo[]>;

export function getFullRange(diag: Diagnostic): Range {
    return (diag as any)?.fullRange || diag.range;
}

export class LeanClient implements Disposable {
    client: LanguageClient
    executable: string
    running: boolean

    private subscriptions: Disposable[] = []

    private didChangeEmitter = new EventEmitter<DidChangeTextDocumentParams>()
    didChange = this.didChangeEmitter.event

    private diagnosticsEmitter = new EventEmitter<PublishDiagnosticsParams>()
    diagnostics = this.diagnosticsEmitter.event

    private didCloseEmitter = new EventEmitter<DidCloseTextDocumentParams>();
    didClose = this.didCloseEmitter.event

    private customNotificationEmitter = new EventEmitter<{method: string, params: any}>();
    /** Fires whenever a custom notification (i.e. one not defined in LSP) is received. */
    customNotification = this.customNotificationEmitter.event;

    progress: ServerProgress = new Map()
    private progressChangedEmitter = new EventEmitter<ServerProgress>()
    progressChanged = this.progressChangedEmitter.event

    private restartedEmitter = new EventEmitter()
    restarted = this.restartedEmitter.event

    private restartingEmitter = new EventEmitter()
    restarting = this.restartingEmitter.event

    private storageManager : LocalStorageService;

    /** Files which are open. */
    private isOpen: Set<string> = new Set()

    constructor(storageManager : LocalStorageService) {
        this.storageManager = storageManager;

        this.subscriptions.push(window.onDidChangeVisibleTextEditors((es) =>
            es.forEach((e) => this.open(e.document))));

        this.subscriptions.push(workspace.onDidChangeConfiguration((e) => this.configChanged(e)));
    }

    dispose(): void {
        this.subscriptions.forEach((s) => s.dispose())
        if (this.isStarted()) void this.stop()
    }

    async restart(): Promise<void> {
        this.restartingEmitter.fire(undefined)

        if (this.isStarted()) {
            await this.stop()
        }

        this.executable = this.storageManager.getValue<string>('LeanPath');
        if (!this.executable) this.executable = executablePath();
        const env = addServerEnvPaths(process.env);
        if (serverLoggingEnabled()) {
            env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
        }
        const serverOptions: ServerOptions = {
            command: this.executable,
            args: ['--server'].concat(serverArgs()),
            options: {
                shell: true,
                env
            }
        }
        const clientOptions: LanguageClientOptions = {
            documentSelector: [documentSelector],
            initializationOptions: {
                editDelay: getElaborationDelay(),
            },
            middleware: {
                handleDiagnostics: (uri, diagnostics, next) => {
                    for (const diag of diagnostics) {
                        if (diag.source === 'Lean 4 server') {
                            diag.source = 'Lean 4';
                        }
                    }
                    next(uri, diagnostics);
                    const uri_ = this.client.code2ProtocolConverter.asUri(uri);
                    const diagnostics_ = [];
                    for (const d of diagnostics) {
                        const d_: Lean4Diagnostic = {
                            ...this.client.code2ProtocolConverter.asDiagnostic(d),
                            fullRange: this.client.code2ProtocolConverter.asRange((d as any).fullRange)
                        };
                        diagnostics_.push(d_);
                    }
                    this.diagnosticsEmitter.fire({uri: uri_, diagnostics: diagnostics_});
                },

                didOpen: () => {
                    // Ignore opening of documents for ctrl+hover
                    // https://github.com/microsoft/vscode/issues/78453
                    return;
                },

                didChange: (data, next) => {
                    next(data);
                    if (!this.running) return; // there was a problem starting lean server.
                    const params = this.client.code2ProtocolConverter.asChangeTextDocumentParams(data);
                    this.didChangeEmitter.fire(params);
                },

                didClose: (doc, next) => {
                    if (!this.isOpen.delete(doc.uri.toString())) return;
                    next(doc);
                    if (!this.running) return; // there was a problem starting lean server.
                    const params = this.client.code2ProtocolConverter.asTextDocumentIdentifier(doc);
                    this.didCloseEmitter.fire({textDocument: params});
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
                        const start = doc.positionAt(match.index)
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
            this.client.start()
            this.isOpen = new Set()
            await this.client.onReady();
            // if we got this far then the client is happy so we are running!
            this.running = true;
        } catch (error) {
            console.log(error);
            // note; we keep the LeanClient alive so that it can be restarted if the
            // user changes the Lean: Executable Path.
            return;
        }

        // HACK(WN): Register a default notification handler to fire on custom notifications.
        // There is an API for this in vscode-jsonrpc but not in vscode-languageclient, so we
        // hack around its implementation.
        this.client.onNotification({
            method: (method: string, params_: any) => {
                if (method === '$/lean/fileProgress') {
                    const params = params_ as LeanFileProgressParams;
                    const uri = this.client.protocol2CodeConverter.asUri(params.textDocument.uri)
                    const newProgress = new Map(this.progress);
                    this.setProgress(newProgress.set(uri, params.processing));
                }

                this.customNotificationEmitter.fire({method, params: params_});
            }
        } as any, null);

        // HACK
        (this.client as any)._serverProcess.stderr.on('data', () =>
            this.client.outputChannel.show(true))

        window.visibleTextEditors.forEach((e) => this.open(e.document));
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
        c2p.asDiagnostic = function (diag: Diagnostic & {fullRange : Range}): Lean4Diagnostic {
            const protDiag = c2pAsDiagnostic.apply(this, [diag])
            protDiag.fullRange = c2p.asRange(diag.fullRange)
            return protDiag
        }
        c2p.asDiagnostics = (diags) => diags.map(d => c2p.asDiagnostic(d))
    }

    private async open(doc: TextDocument) {
        // All open .lean files of this workspace are assumed to be Lean 4 files.
        // We need to do this because by default, .lean is associated with language id `lean`,
        // i.e. Lean 3. vscode-lean is expected to yield when isLean4 is true.
        if (doc.languageId === 'lean') {
            // Only change the id for *visible* documents,
            // because this closes and then reopens the document.
            await languages.setTextDocumentLanguage(doc, 'lean4')
        } else if (doc.languageId !== 'lean4') {
            return
        }
        if (!this.running) return; // there was a problem starting lean server.
        if (this.isOpen.has(doc.uri.toString())) return;
        this.isOpen.add(doc.uri.toString())
        this.client.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: {
                uri: doc.uri.toString(),
                languageId: doc.languageId,
                version: 1,
                text: doc.getText(),
            },
        });
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
            await this.client.stop()
        }
        this.setProgress(new Map())
        this.client = undefined
        this.running = false
    }

    configChanged(e : ConfigurationChangeEvent): void {
        if (this.executable !== executablePath()){
            void this.restart();
        }
    }

    refreshFileDependencies(editor: TextEditor): void {
        if (!this.running) return; // there was a problem starting lean server.
        assert(() => this.isStarted())
        const doc = editor.document
        const uri = doc.uri.toString()
        // This causes a text document version number discontinuity. In
        // (didChange (oldVersion) => refreshFileDependencies => didChange (newVersion))
        // the client emits newVersion = oldVersion + 1, despite the fact that the
        // didOpen packet emitted below initializes the version number to be 1.
        // This is not a problem though, since both client and server are fine
        // as long as the version numbers are monotonous.
        this.client.sendNotification('textDocument/didClose', {
            'textDocument': {
                uri
            }
        })
        this.client.sendNotification('textDocument/didOpen', {
            'textDocument': {
                uri,
                'languageId': 'lean4',
                'version': 1,
                'text': doc.getText()
            }
        })
    }

    private setProgress(newProgress: ServerProgress) {
        this.progress = newProgress
        this.progressChangedEmitter.fire(newProgress)
    }

    async selectInterpreter() : Promise<void> {
        let defaultPath = this.storageManager.getValue<string>('LeanPath');
        if (!defaultPath) {
            defaultPath = 'lean';
        }
        const selectedProgram = await window.showInputBox({
            title: 'Enter path',
            value: defaultPath,
            prompt: 'Enter full path to lean interpreter'
        });
        if (selectedProgram) {
            this.storageManager.setValue<string>('LeanPath', selectedProgram);
            void this.restart();
        }
    }
}
