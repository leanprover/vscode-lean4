import { TextDocument, Position, TextEditor, EventEmitter, Uri, Diagnostic,
    workspace, languages, DocumentHighlight, Range, DocumentHighlightKind, window, Disposable } from 'vscode'
import {
    DidOpenTextDocumentNotification,
    DocumentFilter,
    LanguageClient,
    LanguageClientOptions,
    Protocol2CodeConverter,
    ServerOptions
} from 'vscode-languageclient/node'
import * as ls from 'vscode-languageserver-protocol'
import { executablePath, addServerEnvPaths, serverLoggingEnabled, serverLoggingPath } from './config'
import { PlainGoal, ServerProgress } from './leanclientTypes'
import { assert } from './utils/assert'
import * as path from 'path'

const processingMessage = 'processing...'

const documentSelector: DocumentFilter = {
    scheme: 'file',
    language: 'lean4',
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Lean4Diagnostic extends ls.Diagnostic {
    fullRange: ls.Range;
}

export function getFullRange(diag: Diagnostic): Range {
    return (diag as any)?.fullRange || diag.range;
}

export class LeanClient implements Disposable {
    client: LanguageClient

    private restartedEmitter = new EventEmitter()
    restarted = this.restartedEmitter.event

    private diagnosticsEmitter = new EventEmitter<{uri: Uri, diagnostics: Diagnostic[]}>()
    diagnostics = this.diagnosticsEmitter.event

    progress: ServerProgress = {}
    private progressChangedEmitter = new EventEmitter<ServerProgress>()
    progressChanged = this.progressChangedEmitter.event

    private subscriptions: Disposable[] = []

    private isOpen: Set<string> = new Set()

    constructor() {
        this.subscriptions.push(window.onDidChangeVisibleTextEditors((es) =>
            es.forEach((e) => this.open(e.document))));
    }

    dispose(): void {
        this.subscriptions.forEach((s) => s.dispose())
        if (this.isStarted()) void this.stop()
    }

    async restart(): Promise<void> {
        if (this.isStarted()) {
            await this.stop()
        }
        const env = addServerEnvPaths(process.env);
        if (serverLoggingEnabled()) {
            env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
        }
        const serverOptions: ServerOptions = {
            command: executablePath(),
            args: ['--server'],
            options: {
                shell: true,
                env
            }
        }
        const clientOptions: LanguageClientOptions = {
            documentSelector: [documentSelector],
            middleware: {
                handleDiagnostics: (uri, diagnostics, next) => {
                    const processedUntil = diagnostics.find((d) =>
                        d.message === processingMessage)?.range?.start?.line
                    this.setProgress({...this.progress, [uri.toString()]: processedUntil})
                    diagnostics = diagnostics.filter((d) => d.message !== processingMessage);
                    for (const diag of diagnostics) {
                        if (diag.source === 'Lean 4 server') {
                            diag.source = 'Lean 4';
                        }
                    }
                    next(uri, diagnostics);
                    this.diagnosticsEmitter.fire({uri, diagnostics})
                },

                didOpen: () => {
                    // Ignore opening of documents for ctrl+hover
                    // https://github.com/microsoft/vscode/issues/78453
                    return;
                },

                didClose: (doc, next) => {
                    if (!this.isOpen.delete(doc.uri.toString())) return;
                    next(doc);
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
        this.setProgress(Object.assign({}, ...workspace.textDocuments
            .filter((doc) => languages.match(documentSelector, doc))
            .map((doc) => ({[doc.uri.toString()]: 0}))))
        this.client = new LanguageClient(
            'lean4',
            'Lean 4',
            serverOptions,
            clientOptions
        )
        this.patchProtocol2CodeConverter(this.client.protocol2CodeConverter)
        this.client.start()
        this.isOpen = new Set()
        await this.client.onReady();

        // HACK
        (this.client as any)._serverProcess.stderr.on('data', () =>
            this.client.outputChannel.show(true))

        window.visibleTextEditors.forEach((e) => this.open(e.document));
        this.restartedEmitter.fire(undefined)
    }

    private patchProtocol2CodeConverter(p2c: Protocol2CodeConverter) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const oldAsDiagnostic = p2c.asDiagnostic
        p2c.asDiagnostic = function (protDiag: Lean4Diagnostic): Diagnostic {
            if (!protDiag.message) {
                // Fixes: Notification handler 'textDocument/publishDiagnostics' failed with message: message must be set
                protDiag.message = ' ';
            }
            const diag = oldAsDiagnostic.apply(this, [protDiag])
            if (protDiag.fullRange) {
                diag.fullRange = p2c.asRange(protDiag.fullRange)
            }
            return diag
        }
        p2c.asDiagnostics = (diags) => diags.map((d) => p2c.asDiagnostic(d))
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
        await this.client.stop()
        this.setProgress({})
        this.client = undefined
    }

    refreshFileDependencies(editor: TextEditor): void {
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

    requestPlainGoals(doc: TextDocument, position: Position): Promise<PlainGoal> {
        assert(() => this.isStarted())
        return this.client.sendRequest(
            '$/lean/plainGoal',
            this.client.code2ProtocolConverter.asTextDocumentPositionParams(doc, position))
    }

    private setProgress(newProgress: ServerProgress) {
        this.progress = newProgress
        this.progressChangedEmitter.fire(newProgress)
    }
}