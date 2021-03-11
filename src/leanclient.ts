import { TextDocument, Position, TextEditor, EventEmitter, Uri, Diagnostic, window, workspace, languages } from 'vscode'
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions
} from 'vscode-languageclient/node'
import { executablePath, serverLoggingEnabled, serverLoggingPath } from './config'
import { PlainGoal, ServerProgress } from './leanclientTypes'
import { assert } from './utils/assert'

const processingMessage = 'processing...'

const documentSelector = { scheme: 'file', language: 'lean4' }

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
                    next(uri, diagnostics.filter((d) => d.message !== processingMessage));
                    this.diagnosticsEmitter.fire({uri, diagnostics})
                },
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
        this.client.start()
        this.restartedEmitter.fire(undefined)
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