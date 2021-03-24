import { TextDocument, Position, TextEditor, EventEmitter, Uri, Diagnostic,
    workspace, languages, DocumentHighlight, Range, DocumentHighlightKind } from 'vscode'
import {
    LanguageClient,
    LanguageClientOptions,
    Protocol2CodeConverter,
    ServerOptions
} from 'vscode-languageclient/node'
import * as ls from 'vscode-languageserver-protocol';
import { executablePath, serverLoggingEnabled, serverLoggingPath } from './config'
import { PlainGoal, ServerProgress } from './leanclientTypes'
import { assert } from './utils/assert'

const processingMessage = 'processing...'

const documentSelector = { scheme: 'file', language: 'lean4' }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Lean4Diagnostic extends ls.Diagnostic {
    fullRange: ls.Range;
}

export function getFullRange(diag: Diagnostic): Range {
    return (diag as any)?.fullRange || diag.range;
}

export class LeanClient {
    client: LanguageClient

    private restartedEmitter = new EventEmitter()
    restarted = this.restartedEmitter.event

    private diagnosticsEmitter = new EventEmitter<{uri: Uri, diagnostics: Diagnostic[]}>()
    diagnostics = this.diagnosticsEmitter.event

    progress: ServerProgress = {}
    private progressChangedEmitter = new EventEmitter<ServerProgress>()
    progressChanged = this.progressChangedEmitter.event

    async restart(): Promise<void> {
        if (this.isStarted()) {
            await this.stop()
        }
        const serverOptions: ServerOptions = {
            command: executablePath(),
            args: ['--server'],
            options: {
                shell: true,
                env: { ...process.env }
            }
        }
        if (serverLoggingEnabled()) {
            serverOptions.options.env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
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
        this.restartedEmitter.fire(undefined)
    }

    private patchProtocol2CodeConverter(p2c: Protocol2CodeConverter) {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const oldAsDiagnostic = p2c.asDiagnostic
        p2c.asDiagnostic = function (protDiag: Lean4Diagnostic): Diagnostic {
            const diag = oldAsDiagnostic.apply(this, [protDiag])
            if (protDiag.fullRange) {
                diag.fullRange = p2c.asRange(protDiag.fullRange)
            }
            return diag
        }
        p2c.asDiagnostics = (diags) => diags.map((d) => p2c.asDiagnostic(d))
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