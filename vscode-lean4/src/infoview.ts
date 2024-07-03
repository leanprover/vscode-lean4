import {
    EditorApi,
    InfoviewApi,
    LeanFileProgressParams,
    RpcConnected,
    RpcConnectParams,
    RpcErrorCode,
    RpcKeepAliveParams,
    ServerStoppedReason,
    TextInsertKind,
} from '@leanprover/infoview-api'
import { join } from 'path'
import {
    commands,
    Diagnostic,
    Disposable,
    DocumentSelector,
    env,
    Event,
    ExtensionContext,
    languages,
    Position,
    Range,
    Selection,
    TextEditor,
    TextEditorRevealType,
    Uri,
    ViewColumn,
    WebviewPanel,
    window,
    workspace,
} from 'vscode'
import { PublishDiagnosticsParams } from 'vscode-languageclient'
import * as ls from 'vscode-languageserver-protocol'
import {
    getEditorLineHeight,
    getInfoViewAllErrorsOnLine,
    getInfoViewAutoOpen,
    getInfoViewAutoOpenShowsGoal,
    getInfoViewDebounceTime,
    getInfoViewEmphasizeFirstGoal,
    getInfoViewReverseTacticState,
    getInfoViewShowExpectedType,
    getInfoViewShowGoalNames,
    getInfoViewShowTooltipOnHover,
    getInfoViewStyle,
    minIfProd,
    prodOrDev,
} from './config'
import { LeanClient } from './leanclient'
import { Rpc } from './rpc'
import { LeanClientProvider } from './utils/clientProvider'
import { c2pConverter, p2cConverter } from './utils/converters'
import { ExtUri, parseExtUri, toExtUri } from './utils/exturi'
import { logger } from './utils/logger'
import { displayError, displayInformation } from './utils/notifs'

export interface InfoWebview {
    readonly api: InfoviewApi
    readonly rpc: Rpc
    readonly visible: boolean;
    dispose(): any
    reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
    onDidDispose: Event<void>;
}

export interface InfoWebviewFactory {
    make(editorApi: EditorApi, stylesheet: string, column: number): InfoWebview
}

const keepAlivePeriodMs = 10000

async function rpcConnect(client: LeanClient, uri: ls.DocumentUri): Promise<string> {
    const connParams: RpcConnectParams = { uri }
    const result: RpcConnected = await client.sendRequest('$/lean/rpc/connect', connParams)
    return result.sessionId
}

class RpcSessionAtPos implements Disposable {
    keepAliveInterval?: NodeJS.Timeout
    client: LeanClient

    constructor(
        client: LeanClient,
        public sessionId: string,
        public uri: ls.DocumentUri,
    ) {
        this.client = client
        this.keepAliveInterval = setInterval(async () => {
            const params: RpcKeepAliveParams = { uri, sessionId }
            try {
                await client.sendNotification('$/lean/rpc/keepAlive', params)
            } catch (e) {
                logger.log(`[InfoProvider] failed to send keepalive for ${uri}: ${e}`)
                if (this.keepAliveInterval) clearInterval(this.keepAliveInterval)
            }
        }, keepAlivePeriodMs)
    }

    dispose() {
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval)
        // TODO: at this point we could close the session
    }
}

export class InfoProvider implements Disposable {
    /** Instance of the panel, if it is open. Otherwise `undefined`. */
    private webviewPanel?: InfoWebview
    private subscriptions: Disposable[] = []
    private clientSubscriptions: Disposable[] = []

    private stylesheet: string = ''
    private autoOpened: boolean = false
    private clientProvider: LeanClientProvider

    // Subscriptions are counted and only disposed of when count becomes 0.
    private serverNotifSubscriptions: Map<string, [number, Disposable[]]> = new Map()
    private clientNotifSubscriptions: Map<string, [number, Disposable[]]> = new Map()

    private rpcSessions: Map<string, RpcSessionAtPos> = new Map()

    // the key is the LeanClient.getClientFolder()
    private clientsFailed: Map<string, ServerStoppedReason> = new Map()

    // the key is the uri of the file who's worker has failed.
    private workersFailed: Map<string, ServerStoppedReason> = new Map()

    private subscribeDidChangeNotification(client: LeanClient, method: string) {
        const h = client.didChange(params => {
            void this.webviewPanel?.api.sentClientNotification(method, params)
        })
        return h
    }

    private subscribeDidCloseNotification(client: LeanClient, method: string) {
        const h = client.didClose(params => {
            void this.webviewPanel?.api.sentClientNotification(method, params)
        })
        return h
    }

    private subscribeDiagnosticsNotification(client: LeanClient, method: string) {
        const h = client.diagnostics(params => {
            void this.webviewPanel?.api.gotServerNotification(method, params)
        })
        return h
    }

    private subscribeCustomNotification(client: LeanClient, method: string) {
        const h = client.customNotification(({ method: thisMethod, params }) => {
            if (thisMethod !== method) return
            void this.webviewPanel?.api.gotServerNotification(method, params)
        })
        return h
    }

    private editorApi: EditorApi = {
        sendClientRequest: async (uri: string, method: string, params: any): Promise<any> => {
            const extUri = parseExtUri(uri)
            if (extUri === undefined) {
                return undefined
            }

            const client = this.clientProvider.findClient(extUri)
            if (client) {
                try {
                    const result = await client.sendRequest(method, params)
                    return result
                } catch (ex) {
                    if (ex.code === RpcErrorCode.WorkerCrashed) {
                        // ex codes related with worker exited or crashed
                        logger.log(`[InfoProvider]The Lean Server has stopped processing this file: ${ex.message}`)
                        await this.onWorkerStopped(uri, client, {
                            message: 'The Lean Server has stopped processing this file: ',
                            reason: ex.message as string,
                        })
                    }
                    throw ex
                }
            }
            return undefined
        },
        sendClientNotification: async (uri: string, method: string, params: any): Promise<void> => {
            const extUri = parseExtUri(uri)
            if (extUri === undefined) {
                return
            }

            const client = this.clientProvider.findClient(extUri)
            if (client) {
                await client.sendNotification(method, params)
            }
        },
        subscribeServerNotifications: async method => {
            const el = this.serverNotifSubscriptions.get(method)
            if (el) {
                const [count, h] = el
                this.serverNotifSubscriptions.set(method, [count + 1, h])
                return
            }

            // NOTE(WN): For non-custom notifications we cannot call LanguageClient.onNotification
            // here because that *overwrites* the notification handler rather than registers an extra one.
            // So we have to add a bunch of event emitters to `LeanClient.`
            if (method === 'textDocument/publishDiagnostics') {
                const subscriptions: Disposable[] = []
                for (const client of this.clientProvider.getClients()) {
                    subscriptions.push(this.subscribeDiagnosticsNotification(client, method))
                }
                this.serverNotifSubscriptions.set(method, [1, subscriptions])
            } else if (method.startsWith('$')) {
                const subscriptions: Disposable[] = []
                for (const client of this.clientProvider.getClients()) {
                    subscriptions.push(this.subscribeCustomNotification(client, method))
                }
                this.serverNotifSubscriptions.set(method, [1, subscriptions])
            } else {
                throw new Error(`subscription to ${method} server notifications not implemented`)
            }
        },
        unsubscribeServerNotifications: async method => {
            const el = this.serverNotifSubscriptions.get(method)
            if (!el) throw new Error(`trying to unsubscribe from '${method}' with no active subscriptions`)
            const [count, subscriptions] = el
            if (count === 1) {
                for (const h of subscriptions) {
                    h.dispose()
                }
                this.serverNotifSubscriptions.delete(method)
            } else {
                this.serverNotifSubscriptions.set(method, [count - 1, subscriptions])
            }
        },

        subscribeClientNotifications: async method => {
            const el = this.clientNotifSubscriptions.get(method)
            if (el) {
                const [count, d] = el
                this.clientNotifSubscriptions.set(method, [count + 1, d])
                return
            }

            if (method === 'textDocument/didChange') {
                const subscriptions: Disposable[] = []
                for (const client of this.clientProvider.getClients()) {
                    subscriptions.push(this.subscribeDidChangeNotification(client, method))
                }
                this.clientNotifSubscriptions.set(method, [1, subscriptions])
            } else if (method === 'textDocument/didClose') {
                const subscriptions: Disposable[] = []
                for (const client of this.clientProvider.getClients()) {
                    subscriptions.push(this.subscribeDidCloseNotification(client, method))
                }
                this.clientNotifSubscriptions.set(method, [1, subscriptions])
            } else {
                throw new Error(`Subscription to '${method}' client notifications not implemented`)
            }
        },

        unsubscribeClientNotifications: async method => {
            const el = this.clientNotifSubscriptions.get(method)
            if (!el) throw new Error(`trying to unsubscribe from '${method}' with no active subscriptions`)
            const [count, subscriptions] = el
            if (count === 1) {
                for (const d of subscriptions) {
                    d.dispose()
                }
                this.clientNotifSubscriptions.delete(method)
            } else {
                this.clientNotifSubscriptions.set(method, [count - 1, subscriptions])
            }
        },
        copyToClipboard: async text => {
            await env.clipboard.writeText(text)
            displayInformation(`Copied to clipboard: ${text}`)
        },
        insertText: async (text, kind, tdpp) => {
            let uri: ExtUri | undefined
            let pos: Position | undefined
            if (tdpp) {
                uri = toExtUri(p2cConverter.asUri(tdpp.textDocument.uri))
                if (uri === undefined) {
                    return
                }
                pos = p2cConverter.asPosition(tdpp.position)
            }
            await this.handleInsertText(text, kind, uri, pos)
        },
        applyEdit: async (e: ls.WorkspaceEdit) => {
            const we = await p2cConverter.asWorkspaceEdit(e)
            await workspace.applyEdit(we)
        },
        showDocument: async show => {
            const uri = parseExtUri(show.uri)
            if (uri === undefined) {
                return
            }
            void this.revealEditorSelection(uri, p2cConverter.asRange(show.selection))
        },
        restartFile: async uri => {
            const extUri = parseExtUri(uri)
            if (extUri === undefined) {
                return
            }

            const client = this.clientProvider.findClient(extUri)
            if (!client) {
                return
            }

            const document = workspace.textDocuments.find(doc => extUri.equalsUri(doc.uri))
            if (!document || document.isClosed) {
                return
            }

            await client.restartFile(document)
        },

        createRpcSession: async uri => {
            const extUri = parseExtUri(uri)
            if (extUri === undefined) {
                return ''
            }
            const client = this.clientProvider.findClient(extUri)
            if (!client) return ''
            const sessionId = await rpcConnect(client, uri)
            const session = new RpcSessionAtPos(client, sessionId, uri)
            if (!this.webviewPanel) {
                session.dispose()
                throw Error('infoview disconnect while connecting to RPC session')
            } else {
                this.rpcSessions.set(sessionId, session)
                return sessionId
            }
        },
        closeRpcSession: async sessionId => {
            const session = this.rpcSessions.get(sessionId)
            if (session) {
                this.rpcSessions.delete(sessionId)
                session.dispose()
            }
        },
    }

    constructor(
        private provider: LeanClientProvider,
        private readonly leanDocs: DocumentSelector,
        private context: ExtensionContext,
        private infoWebviewFactory: InfoWebviewFactory
    ) {
        this.clientProvider = provider
        this.updateStylesheet()

        provider.clientAdded(client => {
            void this.onClientAdded(client)
        })

        provider.clientRemoved(client => {
            void this.onClientRemoved(client)
        })

        provider.clientStopped(([client, activeClient, reason]) => {
            void this.onActiveClientStopped(client, activeClient, reason)
        })

        this.subscriptions.push(
            window.onDidChangeActiveTextEditor(() => this.sendPosition()),
            window.onDidChangeTextEditorSelection(() => this.sendPosition()),
            workspace.onDidChangeConfiguration(async _e => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet()
                await this.sendConfig()
            }),
            workspace.onDidChangeTextDocument(async () => {
                await this.sendPosition()
            }),
            commands.registerTextEditorCommand('lean4.displayGoal', editor => this.openPreview(editor)),
            commands.registerCommand('lean4.toggleInfoview', () => this.toggleInfoview()),
            commands.registerTextEditorCommand('lean4.displayList', async editor => {
                await this.openPreview(editor)
                await this.webviewPanel?.api.requestedAction({ kind: 'toggleAllMessages' })
            }),
            commands.registerTextEditorCommand('lean4.infoView.copyToComment', () =>
                this.webviewPanel?.api.requestedAction({ kind: 'copyToComment' }),
            ),
            commands.registerCommand('lean4.infoView.toggleUpdating', () =>
                this.webviewPanel?.api.requestedAction({ kind: 'togglePaused' }),
            ),
            commands.registerCommand('lean4.infoView.toggleExpectedType', () =>
                this.webviewPanel?.api.requestedAction({ kind: 'toggleExpectedType' }),
            ),
            commands.registerTextEditorCommand('lean4.infoView.toggleStickyPosition', () =>
                this.webviewPanel?.api.requestedAction({ kind: 'togglePin' }),
            ),
            commands.registerCommand('lean4.infoview.goToDefinition', args =>
                this.webviewPanel?.api.goToDefinition(args.interactiveCodeTagId),
            ),
        )
    }

    private async onClientRestarted(client: LeanClient) {
        // if we already have subscriptions for a previous client, we need to also
        // subscribe to the same things on this new client.
        for (const [method, [count, subscriptions]] of this.clientNotifSubscriptions) {
            if (method === 'textDocument/didChange') {
                subscriptions.push(this.subscribeDidChangeNotification(client, method))
            } else if (method === 'textDocument/didClose') {
                subscriptions.push(this.subscribeDidCloseNotification(client, method))
            }
        }

        for (const [method, [count, subscriptions]] of this.serverNotifSubscriptions) {
            if (method === 'textDocument/publishDiagnostics') {
                subscriptions.push(this.subscribeDiagnosticsNotification(client, method))
            } else if (method.startsWith('$')) {
                subscriptions.push(this.subscribeCustomNotification(client, method))
            }
        }

        await this.webviewPanel?.api.serverStopped(undefined) // clear any server stopped state
        const folderUri = client.getClientFolder()
        for (const worker of this.workersFailed.keys()) {
            const workerUri = parseExtUri(worker)
            if (workerUri !== undefined && client.isInFolderManagedByThisClient(workerUri)) {
                this.workersFailed.delete(worker)
            }
        }

        if (this.clientsFailed.has(folderUri.toString())) {
            this.clientsFailed.delete(folderUri.toString())
        }
        await this.initInfoView(window.activeTextEditor, client)
    }

    private async onClientAdded(client: LeanClient) {
        logger.log(`[InfoProvider] Adding client for workspace: ${client.getClientFolder()}`)

        this.clientSubscriptions.push(
            client.restarted(async () => {
                logger.log('[InfoProvider] got client restarted event')
                // This event is triggered both the first time the server starts
                // as well as when the server restarts.

                this.clearRpcSessions(client)

                // Need to fully re-initialize this newly restarted client with all the
                // existing subscriptions and resend position info and so on so the
                // infoview updates properly.
                await this.onClientRestarted(client)
            }),
            client.restartedWorker(async uri => {
                logger.log('[InfoProvider] got worker restarted event')
                await this.onWorkerRestarted(uri)
            }),
            client.didSetLanguage(() => this.onLanguageChanged()),
        )

        // Note that when new client is first created it still fires client.restarted
        // event, so all onClientRestarted can happen there so we don't do it twice.
    }

    async onWorkerRestarted(uri: string): Promise<void> {
        await this.webviewPanel?.api.serverStopped(undefined) // clear any server stopped state
        if (this.workersFailed.has(uri)) {
            this.workersFailed.delete(uri)
            logger.log('[InfoProvider] Restarting worker for file: ' + uri)
        }
        await this.sendPosition()
    }

    async onWorkerStopped(uri: string, client: LeanClient, reason: ServerStoppedReason) {
        await this.webviewPanel?.api.serverStopped(reason)

        const extUri = parseExtUri(uri)
        if (extUri === undefined) {
            return
        }

        if (!this.workersFailed.has(uri)) {
            this.workersFailed.set(uri, reason)
        }
        logger.log(`[InfoProvider]client crashed: ${uri}`)
        client.showRestartMessage(true, extUri)
    }

    onClientRemoved(client: LeanClient) {
        // todo: remove subscriptions for this client...
    }

    async onActiveClientStopped(client: LeanClient, activeClient: boolean, reason: ServerStoppedReason) {
        // Will show a message in case the active client stops
        // add failed client into a list (will be removed in case the client is restarted)
        if (activeClient) {
            // means that client and active client are the same and just show the error message
            await this.webviewPanel?.api.serverStopped(reason)
        }

        logger.log(`[InfoProvider] client stopped: ${client.getClientFolder()}`)

        // remember this client is in a stopped state
        const key = client.getClientFolder()
        await this.sendPosition()
        if (!this.clientsFailed.has(key.toString())) {
            this.clientsFailed.set(key.toString(), reason)
        }
        logger.log(`[InfoProvider] client stopped: ${key}`)
        client.showRestartMessage()
    }

    dispose(): void {
        // active client is changing.
        this.clearNotificationHandlers()
        this.clearRpcSessions(null)
        for (const s of this.clientSubscriptions) {
            s.dispose()
        }
        for (const s of this.subscriptions) {
            s.dispose()
        }
        this.webviewPanel?.dispose()
    }

    isOpen(): boolean {
        return this.webviewPanel?.visible === true
    }

    async runTestScript(javaScript: string): Promise<void> {
        if (this.webviewPanel) {
            return this.webviewPanel.api.runTestScript(javaScript)
        } else {
            throw new Error('Cannot run test script, infoview is closed.')
        }
    }

    async getHtmlContents(): Promise<string> {
        if (this.webviewPanel) {
            return this.webviewPanel.api.getInfoviewHtml()
        } else {
            throw new Error('Cannot retrieve infoview HTML, infoview is closed.')
        }
    }

    sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async toggleAllMessages(): Promise<void> {
        if (this.webviewPanel) {
            await this.webviewPanel.api.requestedAction({ kind: 'toggleAllMessages' })
        }
    }

    private updateStylesheet() {
        // Here we add extra CSS variables which depend on the editor configuration,
        // but are not exposed by default.
        // Ref: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content

        const extraCSS = `
            html {
                --vscode-editor-line-height: ${getEditorLineHeight()}px;
            }
        `
        const configCSS = getInfoViewStyle()
        this.stylesheet = extraCSS + configCSS
    }

    private async autoOpen(): Promise<boolean> {
        if (!this.webviewPanel && !this.autoOpened && getInfoViewAutoOpen() && window.activeTextEditor) {
            // only auto-open for lean files, not for markdown.
            if (languages.match(this.leanDocs, window.activeTextEditor.document)) {
                // remember we've auto opened during this session so if user closes it it remains closed.
                this.autoOpened = true
                return await this.openPreview(window.activeTextEditor)
            }
        }
        return false
    }

    private clearNotificationHandlers() {
        for (const [, [, subscriptions]] of this.clientNotifSubscriptions) for (const h of subscriptions) h.dispose()
        this.clientNotifSubscriptions.clear()
        for (const [, [, subscriptions]] of this.serverNotifSubscriptions) for (const h of subscriptions) h.dispose()
        this.serverNotifSubscriptions.clear()
    }

    private clearRpcSessions(client: LeanClient | null) {
        const remaining = new Map()
        for (const [sessionId, sess] of this.rpcSessions) {
            if (client === null || sess.client === client) {
                sess.dispose()
            } else {
                remaining.set(sessionId, sess)
            }
        }
        this.rpcSessions = remaining
    }

    private async toggleInfoview() {
        if (this.webviewPanel) {
            this.webviewPanel.dispose()
            // the onDispose handler sets this.webviewPanel = undefined
        } else if (window.activeTextEditor && window.activeTextEditor.document.languageId === 'lean4') {
            await this.openPreview(window.activeTextEditor)
        } else {
            displayError(
                'No active Lean editor tab. Make sure to focus the Lean editor tab for which you want to open the infoview.',
            )
        }
    }

    private async openPreview(editor: TextEditor): Promise<boolean> {
        const docUri = toExtUri(editor.document.uri)
        if (docUri === undefined) {
            return false
        }

        let column = editor && editor.viewColumn ? editor.viewColumn + 1 : ViewColumn.Two
        if (column === 4) {
            column = ViewColumn.Three
        }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true)
        } else {
            this.webviewPanel = this.infoWebviewFactory.make(this.editorApi, this.stylesheet, column)

            this.webviewPanel.onDidDispose(() => {
                this.webviewPanel = undefined
                this.clearNotificationHandlers()
                this.clearRpcSessions(null) // should be after `webviewPanel = undefined`
            })

            const client = this.clientProvider.findClient(docUri)
            await this.initInfoView(editor, client)
        }
        return true
    }

    private async initInfoView(editor: TextEditor | undefined, client: LeanClient | undefined) {
        if (editor) {
            const loc = this.getLocation(editor)
            if (loc) {
                await this.webviewPanel?.api.initialize(loc)
            }
        }
        // The infoview gets information about file progress, diagnostics, etc.
        // by listening to notifications.  Send these notifications when the infoview starts
        // so that it has up-to-date information.
        if (client?.initializeResult) {
            logger.log('[InfoProvider] initInfoView!')
            await this.sendConfig()
            await this.webviewPanel?.api.serverStopped(undefined) // clear any server stopped state
            await this.webviewPanel?.api.serverRestarted(client.initializeResult)
            await this.sendDiagnostics(client)
            await this.sendProgress(client)
            await this.sendPosition()
        } else if (client === undefined) {
            logger.log('[InfoProvider] initInfoView got null client.')
        } else {
            logger.log('[InfoProvider] initInfoView got undefined client.initializeResult')
        }
    }

    private async sendConfig() {
        await this.webviewPanel?.api.changedInfoviewConfig({
            allErrorsOnLine: getInfoViewAllErrorsOnLine(),
            autoOpenShowsGoal: getInfoViewAutoOpenShowsGoal(),
            debounceTime: getInfoViewDebounceTime(),
            showExpectedType: getInfoViewShowExpectedType(),
            showGoalNames: getInfoViewShowGoalNames(),
            emphasizeFirstGoal: getInfoViewEmphasizeFirstGoal(),
            reverseTacticState: getInfoViewReverseTacticState(),
            showTooltipOnHover: getInfoViewShowTooltipOnHover(),
        })
    }

    private static async getDiagnosticParams(
        uri: Uri,
        diagnostics: readonly Diagnostic[],
    ): Promise<PublishDiagnosticsParams> {
        const params: PublishDiagnosticsParams = {
            uri: c2pConverter.asUri(uri),
            diagnostics: await c2pConverter.asDiagnostics(diagnostics as Diagnostic[]),
        }
        return params
    }

    private async sendDiagnostics(client: LeanClient) {
        const panel = this.webviewPanel
        if (panel) {
            client.getDiagnostics()?.forEach(async (uri, diags) => {
                const params = InfoProvider.getDiagnosticParams(uri, diags)
                await panel.api.gotServerNotification('textDocument/publishDiagnostics', params)
            })
        }
    }

    private async sendProgress(client: LeanClient) {
        if (!this.webviewPanel) return
        for (const [uri, processing] of client.progress) {
            const params: LeanFileProgressParams = {
                textDocument: {
                    uri: c2pConverter.asUri(uri.asUri()),
                    version: 0, // HACK: The infoview ignores this
                },
                processing,
            }
            await this.webviewPanel.api.gotServerNotification('$/lean/fileProgress', params)
        }
    }

    private onLanguageChanged() {
        this.autoOpen()
            .then(async () => {
                await this.sendConfig()
                await this.sendPosition()
            })
            .catch(() => {})
    }

    private getLocation(editor: TextEditor): ls.Location | undefined {
        if (!editor) return undefined
        const uri = editor.document.uri
        const selection = editor.selection
        return {
            uri: uri.toString(),
            range: {
                start: selection.start,
                end: selection.end,
            },
        }
    }

    private async sendPosition() {
        const editor = window.activeTextEditor
        if (!editor) return
        const loc = this.getLocation(editor)
        if (languages.match(this.leanDocs, editor.document) === 0) {
            // language is not yet 'lean4', but the LeanClient will fire the didSetLanguage event
            // in openLean4Document and that's when we can send the position to update the
            // InfoView for the newly opened document.
            return
        }
        const uri = toExtUri(editor.document.uri)
        if (uri === undefined) {
            return
        }
        // actual editor
        if (this.clientsFailed.size > 0 || this.workersFailed.size > 0) {
            const client = this.clientProvider.findClient(uri)
            const uriKey = uri.toString()
            if (client) {
                const folder = client.getClientFolder().toString()
                let reason: ServerStoppedReason | undefined
                if (this.clientsFailed.has(folder)) {
                    reason = this.clientsFailed.get(folder)
                } else if (this.workersFailed.has(uriKey)) {
                    reason = this.workersFailed.get(uriKey)
                }
                if (reason) {
                    // send stopped event
                    await this.webviewPanel?.api.serverStopped(reason)
                } else {
                    await this.updateStatus(loc)
                }
            } else {
                logger.log(
                    '[InfoProvider] ### what does it mean to have sendPosition but no LeanClient for this document???',
                )
            }
        } else {
            await this.updateStatus(loc)
        }
    }

    private async updateStatus(loc: ls.Location | undefined): Promise<void> {
        await this.webviewPanel?.api.serverStopped(undefined) // clear any server stopped state
        await this.autoOpen()
        await this.webviewPanel?.api.changedCursorLocation(loc)
    }

    private async revealEditorSelection(uri: ExtUri, selection?: Range) {
        let editor: TextEditor | undefined
        for (const e of window.visibleTextEditors) {
            if (uri.equalsUri(e.document.uri)) {
                editor = e
                break
            }
        }
        if (!editor) {
            const c = window.activeTextEditor ? window.activeTextEditor.viewColumn : ViewColumn.One
            editor = await window.showTextDocument(uri.asUri(), { viewColumn: c, preserveFocus: false })
        }
        if (selection !== undefined) {
            editor.revealRange(selection, TextEditorRevealType.InCenterIfOutsideViewport)
            editor.selection = new Selection(selection.start, selection.end)
            // ensure the text document has the keyboard focus.
            await window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false })
        }
    }

    private async handleInsertText(
        text: string,
        kind: TextInsertKind,
        uri?: ExtUri | undefined,
        pos?: Position | undefined,
    ) {
        let editor: TextEditor | undefined
        if (uri) {
            editor = window.visibleTextEditors.find(e => uri.equalsUri(e.document.uri))
        } else {
            editor = window.activeTextEditor
            if (!editor) {
                // sometimes activeTextEditor is null.
                editor = window.visibleTextEditors.find(e => e.document.languageId === 'lean4')
            }
        }
        if (!editor) {
            // user must have switch away from any lean source file in which case we don't know
            // what to do here.  TODO: show a popup error?  Or should we use the last uri used in
            // sendPosition and automatically activate that editor?
            return
        }
        pos = pos ? pos : editor.selection.active
        if (kind === 'above') {
            // in this case, assume that we actually want to insert at the same
            // indentation level as the neighboring text
            const current_line = editor.document.lineAt(pos.line)
            const spaces = current_line.firstNonWhitespaceCharacterIndex
            const margin_str = [...Array(spaces).keys()].map(x => ' ').join('')
            let new_command = text.replace(/\n/g, '\n' + margin_str)
            new_command = `${margin_str}${new_command}\n`
            const insertPosition = current_line.range.start

            await editor.edit(builder => {
                builder.insert(insertPosition, new_command)
            })
        } else {
            await editor.edit(builder => {
                if (pos) builder.insert(pos, text)
            })
            editor.selection = new Selection(pos, pos)
        }
        // ensure the text document has the keyboard focus.
        await window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false })
    }
}
