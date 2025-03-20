import {
    DiagnosticCollection,
    Disposable,
    DocumentHighlight,
    DocumentHighlightKind,
    EventEmitter,
    OutputChannel,
    Progress,
    ProgressLocation,
    ProgressOptions,
    Range,
    window,
    WorkspaceFolder,
} from 'vscode'
import {
    ClientCapabilities,
    DiagnosticSeverity,
    DidChangeTextDocumentParams,
    DidCloseTextDocumentParams,
    DocumentFilter,
    InitializeResult,
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    ServerOptions,
    State,
    StaticFeature,
} from 'vscode-languageclient/node'

import {
    LeanDiagnostic,
    LeanFileProgressParams,
    LeanFileProgressProcessingInfo,
    ServerStoppedReason,
} from '@leanprover/infoview-api'
import {
    getElaborationDelay,
    getFallBackToStringOccurrenceHighlighting,
    serverArgs,
    serverLoggingEnabled,
    serverLoggingPath,
    shouldAutofocusOutput,
} from './config'
import { logger } from './utils/logger'
// @ts-ignore
import path from 'path'
import { SemVer } from 'semver'
import {
    c2pConverter,
    LeanPublishDiagnosticsParams,
    p2cConverter,
    patchConverters,
    setDependencyBuildMode,
} from './utils/converters'
import { elanInstalledToolchains } from './utils/elan'
import { ExtUri, parseExtUri, toExtUri } from './utils/exturi'
import { leanRunner } from './utils/leanCmdRunner'
import { lean, LeanDocument } from './utils/leanEditorProvider'
import {
    displayNotification,
    displayNotificationWithOptionalInput,
    displayNotificationWithOutput,
} from './utils/notifs'
import { willUseLakeServer } from './utils/projectInfo'

interface LeanClientCapabilties {
    silentDiagnosticSupport?: boolean | undefined
}

const leanClientCapabilities: LeanClientCapabilties = {
    silentDiagnosticSupport: true,
}

import { ChildProcess } from 'child_process'
import express from 'express'
import * as rpc from 'vscode-ws-jsonrpc'
import * as jsonrpcserver from 'vscode-ws-jsonrpc/server'
import { WebSocketServer } from 'ws'

const app = express()

const PORT = 8080

const initResponse = {
    result: {
        serverInfo: {
            version: '0.2.0',
            name: 'Lean 4 Server',
        },
        capabilities: {
            workspaceSymbolProvider: true,
            typeDefinitionProvider: true,
            textDocumentSync: {
                willSaveWaitUntil: false,
                willSave: false,
                save: {
                    includeText: true,
                },
                openClose: true,
                change: 2,
            },
            semanticTokensProvider: {
                range: true,
                legend: {
                    tokenTypes: [
                        'keyword',
                        'variable',
                        'property',
                        'function',
                        'namespace',
                        'type',
                        'class',
                        'enum',
                        'interface',
                        'struct',
                        'typeParameter',
                        'parameter',
                        'enumMember',
                        'event',
                        'method',
                        'macro',
                        'modifier',
                        'comment',
                        'string',
                        'number',
                        'regexp',
                        'operator',
                        'decorator',
                        'leanSorryLike',
                    ],
                    tokenModifiers: [
                        'declaration',
                        'definition',
                        'readonly',
                        'static',
                        'deprecated',
                        'abstract',
                        'async',
                        'modification',
                        'documentation',
                        'defaultLibrary',
                    ],
                },
                full: true,
            },
            renameProvider: { prepareProvider: true },
            referencesProvider: true,
            inlayHintProvider: { workDoneProgress: false, resolveProvider: false },
            hoverProvider: true,
            foldingRangeProvider: true,
            documentSymbolProvider: true,
            documentHighlightProvider: true,
            definitionProvider: true,
            declarationProvider: true,
            completionProvider: { triggerCharacters: ['.'], resolveProvider: true },
            codeActionProvider: {
                workDoneProgress: false,
                resolveProvider: true,
                codeActionKinds: ['quickfix', 'refactor'],
            },
            callHierarchyProvider: true,
        },
    },
    jsonrpc: '2.0',
    id: 0,
}

const server = app.listen(PORT, () => console.log(`Listening on ${PORT}`))

const wss = new WebSocketServer({ server })

function startServerProcess(serverProcess: ChildProcess) {
    serverProcess.on('error', error => console.error(`Launching Lean Server failed: ${error}`))

    if (serverProcess.stderr !== null) {
        serverProcess.stderr.on('data', data => {
            console.error(`Lean Server: ${data}`)
        })
    }

    return serverProcess
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type ServerProgress = Map<ExtUri, LeanFileProgressProcessingInfo[]>

export class LeanClient implements Disposable {
    running: boolean
    private client: LanguageClient | undefined
    private client_web: LanguageClient | undefined
    private outputChannel: OutputChannel
    folderUri: ExtUri
    private subscriptions: Disposable[] = []
    private noPrompt: boolean = false
    private showingRestartMessage: boolean = false
    private isRestarting: boolean = false
    private staleDepNotifier: Disposable | undefined

    private openServerDocuments: Set<string> = new Set<string>()

    private didChangeEmitter = new EventEmitter<DidChangeTextDocumentParams>()
    didChange = this.didChangeEmitter.event

    private diagnosticsEmitter = new EventEmitter<LeanPublishDiagnosticsParams>()
    diagnostics = this.diagnosticsEmitter.event

    private didSetLanguageEmitter = new EventEmitter<string>()
    didSetLanguage = this.didSetLanguageEmitter.event

    private didCloseEmitter = new EventEmitter<DidCloseTextDocumentParams>()
    didClose = this.didCloseEmitter.event

    private customNotificationEmitter = new EventEmitter<{ method: string; params: any }>()
    /** Fires whenever a custom notification (i.e. one not defined in LSP) is received. */
    customNotification = this.customNotificationEmitter.event

    /** saved progress info in case infoview is opened, it needs to get all of it. */
    progress: ServerProgress = new Map()

    private progressChangedEmitter = new EventEmitter<[string, LeanFileProgressProcessingInfo[]]>()
    progressChanged = this.progressChangedEmitter.event

    private stoppedEmitter = new EventEmitter<ServerStoppedReason>()
    stopped = this.stoppedEmitter.event

    private restartedEmitter = new EventEmitter()
    restarted = this.restartedEmitter.event

    private restartingEmitter = new EventEmitter()
    restarting = this.restartingEmitter.event

    private restartedWorkerEmitter = new EventEmitter<string>()
    restartedWorker = this.restartedWorkerEmitter.event

    private serverFailedEmitter = new EventEmitter<string>()
    serverFailed = this.serverFailedEmitter.event

    constructor(folderUri: ExtUri, outputChannel: OutputChannel) {
        this.outputChannel = outputChannel
        this.folderUri = folderUri
        this.subscriptions.push(new Disposable(() => this.staleDepNotifier?.dispose()))
    }

    dispose(): void {
        this.subscriptions.forEach(s => s.dispose())
        if (this.isStarted()) void this.stop()
    }

    showRestartMessage(restartFile: boolean = false, uri?: ExtUri | undefined) {
        if (this.showingRestartMessage) {
            return
        }
        this.showingRestartMessage = true
        const finalizer = () => {
            this.showingRestartMessage = false
        }
        let restartItem: string
        let messageTitle: string
        if (!restartFile) {
            restartItem = 'Restart Lean Server'
            messageTitle = 'Lean Server has stopped unexpectedly.'
        } else {
            restartItem = 'Restart Lean Server on this file'
            messageTitle = 'The Lean Server has stopped processing this file.'
        }
        displayNotificationWithOptionalInput(
            'Error',
            messageTitle,
            [
                {
                    input: restartItem,
                    action: () => {
                        if (restartFile && uri !== undefined) {
                            const document = lean.getLeanDocumentByUri(uri)
                            if (document !== undefined) {
                                void this.restartFile(document)
                            }
                        } else {
                            void this.start()
                        }
                    },
                },
            ],
            finalizer,
        )
    }

    async restart(): Promise<void> {
        if (this.isRestarting) {
            displayNotification('Error', 'Client is already being started.')
            return
        }
        this.isRestarting = true
        try {
            let defaultToolchain: string | undefined
            if (this.folderUri.scheme === 'untitled') {
                const installedToolchainsResult = await elanInstalledToolchains()
                switch (installedToolchainsResult.kind) {
                    case 'Success':
                        if (installedToolchainsResult.defaultToolchain === undefined) {
                            this.serverFailedEmitter.fire(
                                'No default Lean version set - cannot launch client for untitled file.',
                            )
                            return
                        }
                        defaultToolchain = installedToolchainsResult.defaultToolchain
                        break
                    case 'ElanNotFound':
                        defaultToolchain = undefined
                        break
                    case 'ExecutionError':
                        this.serverFailedEmitter.fire(
                            `Cannot determine Lean version information for launching a client for an untitled file: ${installedToolchainsResult.message}`,
                        )
                        return
                }
            }

            logger.log('[LeanClient] Restarting Lean Server')
            if (this.isStarted()) {
                await this.stop()
            }

            this.restartingEmitter.fire(undefined)

            const progressOptions: ProgressOptions = {
                location: ProgressLocation.Notification,
                title: '[Server Startup] Starting Lean language client',
                cancellable: false,
            }
            await window.withProgress(
                progressOptions,
                async progress => await this.startClient(progress, defaultToolchain),
            )
        } finally {
            this.isRestarting = false
        }
    }

    private async determineToolchainOverride(
        defaultToolchain: string | undefined,
    ): Promise<{ kind: 'Override'; toolchain: string } | { kind: 'NoOverride' } | { kind: 'Error'; message: string }> {
        const cwdUri = this.folderUri.scheme === 'file' ? this.folderUri : undefined
        const toolchainDecision = await leanRunner.decideToolchain({
            channel: this.outputChannel,
            context: 'Server Startup',
            cwdUri,
            toolchainUpdateMode: 'PromptAboutUpdate',
        })

        if (toolchainDecision.kind === 'Error') {
            return toolchainDecision
        }

        if (toolchainDecision.kind === 'RunWithSpecificToolchain') {
            return { kind: 'Override', toolchain: toolchainDecision.toolchain }
        }

        toolchainDecision.kind satisfies 'RunWithActiveToolchain'

        if (this.folderUri.scheme === 'untitled' && defaultToolchain !== undefined) {
            // Fixes issue #227, for adhoc files it would pick up the cwd from the open folder
            // which is not what we want.  For adhoc files we want the (default) toolchain instead.
            return { kind: 'Override', toolchain: defaultToolchain }
        }
        return { kind: 'NoOverride' }
    }

    private async startClient(
        progress: Progress<{ message?: string; increment?: number }>,
        defaultToolchain: string | undefined,
    ): Promise<void> {
        // Should only be called from `restart`

        const startTime = Date.now()
        progress.report({})
        const toolchainOverrideResult = await this.determineToolchainOverride(defaultToolchain)
        if (toolchainOverrideResult.kind === 'Error') {
            this.serverFailedEmitter.fire(`Error while starting client: ${toolchainOverrideResult.message}`)
            return
        }
        const toolchainOverride: string | undefined =
            toolchainOverrideResult.kind === 'Override' ? toolchainOverrideResult.toolchain : undefined

        this.client = await this.setupClient(toolchainOverride)

        this.client_web = await this.setupClient(toolchainOverride)

        await this.client_web.start()

        let insideRestart = true
        try {
            this.client.onDidChangeState(async s => {
                // see https://github.com/microsoft/vscode-languageserver-node/issues/825
                if (s.newState === State.Starting) {
                    logger.log('[LeanClient] starting')
                } else if (s.newState === State.Running) {
                    const end = Date.now()
                    logger.log(`[LeanClient] running, started in ${end - startTime} ms`)
                    this.running = true // may have been auto restarted after it failed.
                    if (!insideRestart) {
                        this.restartedEmitter.fire(undefined)
                    }
                } else if (s.newState === State.Stopped) {
                    this.running = false
                    logger.log('[LeanClient] has stopped or it failed to start')
                    if (!this.noPrompt) {
                        // only raise this event and show the message if we are not the ones
                        // who called the stop() method.
                        this.stoppedEmitter.fire({ message: 'Lean server has stopped.', reason: '' })
                        this.showRestartMessage()
                    }
                }
            })
            await this.client.start()
            const version = this.client.initializeResult?.serverInfo?.version
            if (version && new SemVer(version).compare('0.2.0') < 0) {
                if (this.staleDepNotifier) {
                    this.staleDepNotifier.dispose()
                }
                this.staleDepNotifier = this.diagnostics(params => this.checkForImportsOutdatedError(params))
            }

            // if we got this far then the client is happy so we are running!
            this.running = true
        } catch (error) {
            const msg = '' + error
            logger.log(`[LeanClient] restart error ${msg}`)
            this.outputChannel.appendLine(msg)
            this.serverFailedEmitter.fire(msg)
            insideRestart = false
        }

        // HACK(WN): Register a default notification handler to fire on custom notifications.
        // A mechanism to do this is provided in vscode-jsonrpc. One can register a `StarNotificationHandler`
        // here: https://github.com/microsoft/vscode-languageserver-node/blob/b2fc85d28a1a44c22896559ee5f4d3ba37a02ef5/jsonrpc/src/common/connection.ts#L497
        // which fires on any LSP notifications not in the standard, for example the `$/lean/..` ones.
        // However this mechanism is not exposed in vscode-languageclient, so we hack around its implementation.
        const starHandler = (method: string, params_: any) => {
            if (method === '$/lean/fileProgress' && this.client) {
                const params = params_ as LeanFileProgressParams
                const uri = toExtUri(p2cConverter.asUri(params.textDocument.uri))
                if (uri !== undefined) {
                    this.progressChangedEmitter.fire([uri.toString(), params.processing])
                    // save the latest progress on this Uri in case infoview needs it later.
                    this.progress.set(uri, params.processing)
                }
            }

            this.customNotificationEmitter.fire({ method, params: params_ })
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.client.onNotification(starHandler as any, () => {})

        // Reveal the standard error output channel when the server prints something to stderr.
        // The vscode-languageclient library already takes care of writing it to the output channel.
        let stderrMsgBoxVisible = false
        ;(this.client as any)._serverProcess.stderr.on('data', async (chunk: Buffer) => {
            if (shouldAutofocusOutput()) {
                this.client?.outputChannel.show(true)
            } else if (!stderrMsgBoxVisible) {
                stderrMsgBoxVisible = true
                const finalizer = () => {
                    stderrMsgBoxVisible = false
                }
                displayNotificationWithOutput(
                    'Error',
                    `Lean server printed an error:\n${chunk.toString()}`,
                    [],
                    finalizer,
                )
            }
        })

        const serverProcess = (this.client_web as any)._serverProcess

        wss.addListener('connection', function (ws, req) {
            console.log(`Socket opened`, serverProcess)

            const ps = startServerProcess(serverProcess)

            const socket: rpc.IWebSocket = {
                onMessage: cb => {
                    ws.on('message', cb)
                },
                onError: cb => {
                    ws.on('error', cb)
                },
                onClose: cb => {
                    ws.on('close', cb)
                },
                send: data => {
                    ws.send(data)
                },
                dispose: function (): void {
                    throw new Error('Function not implemented.')
                },
            }

            const reader = new rpc.WebSocketMessageReader(socket)
            const writer = new rpc.WebSocketMessageWriter(socket)

            const socketConnection = jsonrpcserver.createConnection(reader, writer, () => ws.close())
            const serverConnection = jsonrpcserver.createProcessStreamConnection(ps)

            if (serverConnection) {
                socketConnection.reader.listen(message => {
                    console.debug('Received message:', message)

                    if ((message as any).method === 'initialize') {
                        socketConnection.writer.write(initResponse)
                    } else if ((message as any).method === "shutdown") {
                        const response = { jsonrpc: "2.0", id: (message as any).id, result: null };
                        socketConnection.writer.write(response);
                    } else if ((message as any).method === "exit") {

                    } else {
                        serverConnection.writer.write(message)
                    }
                })

                socketConnection.forward(serverConnection, message => message)
                serverConnection.forward(socketConnection, message => message)
            }

            if (ps.stderr) {
                ps.stderr.on('data', data => {
                    let msg = {
                        jsonrpc: '2.0',
                        id: '1',
                        error: {
                            message: data.toString(),
                            code: '-1',
                        },
                    }
                    ws.send(JSON.stringify(msg))
                })
            }

            ws.on('error', error => {
                console.error(`WebSocket error: ${error.message}`)
            })

            ws.on('close', () => {
                console.log(`[${new Date()}] Socket closed`)
            })
            console.log('server connection success')
        })

        this.restartedEmitter.fire(undefined)
        insideRestart = false
    }

    private checkForImportsOutdatedError(params: LeanPublishDiagnosticsParams) {
        const fileUri = parseExtUri(params.uri)
        if (fileUri === undefined) {
            return
        }

        const fileName = fileUri.scheme === 'file' ? path.basename(fileUri.fsPath) : 'untitled'
        const isImportsOutdatedError = params.diagnostics.some(
            d =>
                d.severity === DiagnosticSeverity.Error &&
                d.message.includes('Imports are out of date and must be rebuilt') &&
                d.range.start.line === 0 &&
                d.range.start.character === 0 &&
                d.range.end.line === 0 &&
                d.range.end.character === 0,
        )
        if (!isImportsOutdatedError) {
            return
        }

        const message = `Imports of '${fileName}' are out of date and must be rebuilt. Restarting the file will rebuild them.`
        const input = 'Restart File'
        displayNotificationWithOptionalInput('Information', message, [
            {
                input,
                action: () => {
                    const document = lean.getLeanDocumentByUri(fileUri)
                    if (document === undefined) {
                        displayNotification(
                            'Error',
                            `'${fileName}' was closed in the meantime. Imports will not be rebuilt.`,
                        )
                        return
                    }

                    void this.restartFile(document)
                },
            },
        ])
    }

    async withStoppedClient(action: () => Promise<void>): Promise<'Success' | 'IsRestarting'> {
        if (this.isRestarting) {
            return 'IsRestarting'
        }
        this.isRestarting = true // Ensure that client cannot be restarted in the mean-time
        try {
            if (this.isStarted()) {
                await this.stop()
            }

            await action()
        } finally {
            this.isRestarting = false
        }

        await this.restart()
        return 'Success'
    }

    isInFolderManagedByThisClient(uri: ExtUri): boolean {
        if (this.folderUri.scheme === 'untitled' && uri.scheme === 'untitled') {
            return true
        }
        if (this.folderUri.scheme === 'file' && uri.scheme === 'file') {
            return uri.isInFolder(this.folderUri)
        }
        return false
    }

    getClientFolder(): ExtUri {
        return this.folderUri
    }

    start(): Promise<void> {
        return this.restart()
    }

    isStarted(): boolean {
        return this.client !== undefined
    }

    isRunning(): boolean {
        if (this.client) {
            return this.running
        }
        return false
    }

    async stop(): Promise<void> {
        if (this.client && this.running) {
            this.noPrompt = true
            try {
                // some timing conditions can happen while running unit tests that cause
                // this to throw an exception which then causes those tests to fail.
                await this.client.stop()
            } catch (e) {
                logger.log(`[LeanClient] Error stopping language client: ${e}`)
            }
        }

        this.noPrompt = false
        this.progress = new Map()
        this.client = undefined
        this.openServerDocuments = new Set()
        this.running = false
    }

    async restartFile(leanDoc: LeanDocument): Promise<void> {
        console.log('(this.client as any)._serverProcess', (this.client as any)._serverProcess)

        if (this.client === undefined || !this.running) return // there was a problem starting lean server.

        if (!this.isInFolderManagedByThisClient(leanDoc.extUri)) {
            return
        }

        const uri = leanDoc.extUri.toString()
        if (!this.openServerDocuments.delete(uri)) {
            return
        }
        logger.log(`[LeanClient] Restarting File: ${uri}`)
        await this.client.sendNotification(
            'textDocument/didClose',
            this.client.code2ProtocolConverter.asCloseTextDocumentParams(leanDoc.doc),
        )

        if (this.openServerDocuments.has(uri)) {
            return
        }
        this.openServerDocuments.add(uri)
        await this.client.sendNotification(
            'textDocument/didOpen',
            setDependencyBuildMode(this.client.code2ProtocolConverter.asOpenTextDocumentParams(leanDoc.doc), 'once'),
        )

        this.restartedWorkerEmitter.fire(uri)
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    sendRequest(method: string, params: any): Promise<any> {
        return this.running && this.client
            ? this.client.sendRequest(method, params)
            : new Promise<any>((_, reject) => {
                  reject('No connection to Lean')
              })
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    sendNotification(method: string, params: any): Promise<void> | undefined {
        return this.running && this.client ? this.client.sendNotification(method, params) : undefined
    }

    getDiagnostics(): DiagnosticCollection | undefined {
        return this.running ? this.client?.diagnostics : undefined
    }

    get initializeResult(): InitializeResult | undefined {
        return this.running ? this.client?.initializeResult : undefined
    }

    private async determineServerOptions(toolchainOverride: string | undefined): Promise<ServerOptions> {
        const env = Object.assign({}, process.env)
        if (serverLoggingEnabled()) {
            env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
        }

        const [serverExecutable, options] = await this.determineExecutable()
        if (toolchainOverride) {
            options.unshift('+' + toolchainOverride)
        }

        const cwd = this.folderUri.scheme === 'file' ? this.folderUri.fsPath : undefined
        if (cwd) {
            // Add folder name to command-line so that it shows up in `ps aux`.
            options.push(cwd)
        } else {
            options.push('untitled')
        }

        return {
            command: serverExecutable,
            args: options.concat(serverArgs()),
            options: {
                cwd,
                env,
            },
        }
    }

    private async determineExecutable(): Promise<[string, string[]]> {
        if (await willUseLakeServer(this.folderUri)) {
            return ['lake', ['serve', '--']]
        } else {
            return ['lean', ['--server']]
        }
    }

    private obtainClientOptions(): LanguageClientOptions {
        const documentSelector: DocumentFilter = {
            language: 'lean4',
        }

        let workspaceFolder: WorkspaceFolder | undefined
        documentSelector.scheme = this.folderUri.scheme
        if (this.folderUri.scheme === 'file') {
            const escapedPath = this.folderUri.fsPath.replace(/[?*()[\]{}]/g, '[$&]')
            documentSelector.pattern = `${escapedPath}/**/*`
            workspaceFolder = {
                uri: this.folderUri.asUri(),
                name: path.basename(this.folderUri.fsPath),
                index: 0, // the language client library does not actually need this index
            }
        }

        return {
            outputChannel: this.outputChannel,
            revealOutputChannelOn: RevealOutputChannelOn.Never, // contrary to the name, this disables the message boxes
            documentSelector: [documentSelector],
            workspaceFolder,
            initializationOptions: {
                editDelay: getElaborationDelay(),
                hasWidgets: true,
            },
            connectionOptions: {
                maxRestartCount: 0,
                cancellationStrategy: undefined as any,
            },
            middleware: {
                handleDiagnostics: (uri, diagnostics, next) => {
                    const diagnosticsInVsCode = diagnostics.filter(d => !('isSilent' in d && d.isSilent))
                    next(uri, diagnosticsInVsCode)
                    const uri_ = c2pConverter.asUri(uri)
                    const diagnostics_: LeanDiagnostic[] = []
                    for (const d of diagnostics) {
                        const d_: LeanDiagnostic = {
                            ...c2pConverter.asDiagnostic(d),
                        }
                        diagnostics_.push(d_)
                    }
                    this.diagnosticsEmitter.fire({ uri: uri_, diagnostics: diagnostics_ })
                },

                didOpen: async (doc, next) => {
                    const docUri = toExtUri(doc.uri)
                    if (!docUri) {
                        return // This should never happen since the glob we launch the client for ensures that all uris are ext uris
                    }

                    // This will sometimes open invisible documents in the language server
                    // (e.g. holding `Ctrl` while hovering over an identifier will quickly emit a `didOpen` and then a `didClose` notification for the document the identifier is in).
                    // There is no good way to prevent this (c.f. https://github.com/microsoft/vscode-languageserver-node/issues/848#issuecomment-2185043021),
                    // but specifically in the case of `Ctrl`+Hover, the language server typically seems to not start expensive elaboration for the invisible document.
                    // We may however launch a new server instance if the document is in a different project (e.g. core).

                    if (this.openServerDocuments.has(docUri.toString())) {
                        return
                    }
                    this.openServerDocuments.add(docUri.toString())

                    await next(doc)

                    // Opening the document may have set the language ID.
                    this.didSetLanguageEmitter.fire(doc.languageId)
                },

                didChange: async (data, next) => {
                    await next(data)
                    const params = c2pConverter.asChangeTextDocumentParams(
                        data,
                        data.document.uri,
                        data.document.version,
                    )
                    this.didChangeEmitter.fire(params)
                },

                didClose: async (doc, next) => {
                    const docUri = toExtUri(doc.uri)
                    if (!docUri) {
                        return // This should never happen since the glob we launch the client for ensures that all uris are ext uris
                    }

                    if (!this.openServerDocuments.delete(docUri.toString())) {
                        // Do not send `didClose` if we filtered the corresponding `didOpen` (see comment in the `didOpen` middleware).
                        // The language server is only resilient against requests for closed files, not the `didClose` notification itself.
                        return
                    }

                    await next(doc)

                    const params = c2pConverter.asCloseTextDocumentParams(doc)
                    this.didCloseEmitter.fire(params)
                },

                provideDocumentHighlights: async (doc, pos, ctok, next) => {
                    const leanHighlights = await next(doc, pos, ctok)
                    if (leanHighlights?.length) return leanHighlights

                    // vscode doesn't fall back to textual highlights, so we
                    // need to do that manually if the user asked for it
                    if (!getFallBackToStringOccurrenceHighlighting()) {
                        return []
                    }

                    await new Promise(res => setTimeout(res, 250))
                    if (ctok.isCancellationRequested) return

                    const wordRange = doc.getWordRangeAtPosition(pos)
                    if (!wordRange) return
                    const word = doc.getText(wordRange)

                    const highlights: DocumentHighlight[] = []
                    const text = doc.getText()
                    const nonWordPattern = '[`~@$%^&*()-=+\\[{\\]}⟨⟩⦃⦄⟦⟧⟮⟯‹›\\\\|;:",./\\s]|^|$'
                    const regexp = new RegExp(`(?<=${nonWordPattern})${escapeRegExp(word)}(?=${nonWordPattern})`, 'g')
                    for (const match of text.matchAll(regexp)) {
                        const start = doc.positionAt(match.index ?? 0)
                        highlights.push({
                            range: new Range(start, start.translate(0, match[0].length)),
                            kind: DocumentHighlightKind.Text,
                        })
                    }

                    return highlights
                },
            },
        }
    }

    private async setupClient(toolchainOverride: string | undefined): Promise<LanguageClient> {
        const serverOptions: ServerOptions = await this.determineServerOptions(toolchainOverride)
        const clientOptions: LanguageClientOptions = this.obtainClientOptions()

        const client = new LanguageClient('lean4', 'Lean 4', serverOptions, clientOptions)
        const leanCapabilityFeature: StaticFeature = {
            initialize(_1, _2) {},
            getState() {
                return { kind: 'static' }
            },
            fillClientCapabilities(capabilities: ClientCapabilities & { lean?: LeanClientCapabilties | undefined }) {
                capabilities.lean = leanClientCapabilities
            },
            dispose() {},
        }
        client.registerFeature(leanCapabilityFeature)

        patchConverters(client.protocol2CodeConverter, client.code2ProtocolConverter)
        return client
    }
}
