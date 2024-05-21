import type {
    DocumentUri,
    InitializeResult,
    Location,
    ShowDocumentParams,
    TextDocumentPositionParams,
    WorkspaceEdit,
} from 'vscode-languageserver-protocol'

/**
 * An insert `here` should be written exactly at the specified position,
 * while one `above` should go on the preceding line.
 */
export type TextInsertKind = 'here' | 'above'

/** Interface that the InfoView WebView uses to talk to the hosting editor. */
export interface EditorApi {
    /** Make a request to the LSP server. */
    sendClientRequest(uri: string, method: string, params: any): Promise<any>
    /** Send a notification to the LSP server. */
    sendClientNotification(uri: string, method: string, params: any): Promise<void>

    /**
     * Subscribe to notifications from the LSP server with the specified `method`.
     * Notifications which have been subscribed to will be fired through {@link InfoviewApi.gotServerNotification}.
     * This may be called multiple times, in which case the editor must count the subscriptions and only
     * stop firing events when `unsubscribe` has been called the same amount of times.
     */
    subscribeServerNotifications(method: string): Promise<void>
    unsubscribeServerNotifications(method: string): Promise<void>

    /**
     * Like {@link subscribeServerNotifications}, but for client->server notifications.
     */
    subscribeClientNotifications(method: string): Promise<void>
    unsubscribeClientNotifications(method: string): Promise<void>

    /** Put `text` in the user's clipboard. */
    copyToClipboard(text: string): Promise<void>

    // NOTE: We could implement everything below in the infoview given `emulateServerNotification`.
    // But the API is small enough it may not be worth the hacks for now.
    /**
     * Send a notification to the LSP client as if it came from the LSP server.
     * This allows us to re-use functionality already implemented in the LSP client,
     * for example making file edits.
     */
    //emulateServerNotification(method: string, params: any): Promise<void>;

    /** Insert text into a document. When `pos` is not present, write at the current cursor location. */
    insertText(text: string, kind: TextInsertKind, pos?: TextDocumentPositionParams): Promise<void>

    /** Applies the given WorkspaceEdit to the workspace. */
    applyEdit(te: WorkspaceEdit): Promise<void>

    /** Highlight a range in a document in the editor. */
    showDocument(show: ShowDocumentParams): Promise<void>

    /** Restarts the given file. */
    restartFile(uri: string): Promise<void>

    /**
     * Creates an RPC session for the given uri and returns the session id.
     * The extension takes care of keeping the RPC session alive.
     * (The infoview cannot reliably send keep-alive messages because setInterval
     * is throttled in the infoview when the vscode window is not visible.)
     */
    createRpcSession(uri: DocumentUri): Promise<string>
    /** Closes an RPC session created with `createRpcSession`. */
    closeRpcSession(sessionId: string): Promise<void>
}

export interface InfoviewTacticStateFilter {
    name?: string
    regex: string
    match: boolean
    flags: string
}

export interface InfoviewConfig {
    allErrorsOnLine: boolean
    autoOpenShowsGoal: boolean
    debounceTime: number
    showExpectedType: boolean
    showGoalNames: boolean
    emphasizeFirstGoal: boolean
    reverseTacticState: boolean
    showTooltipOnHover: boolean
}

export const defaultInfoviewConfig: InfoviewConfig = {
    allErrorsOnLine: true,
    autoOpenShowsGoal: true,
    debounceTime: 50,
    showExpectedType: true,
    showGoalNames: true,
    emphasizeFirstGoal: false,
    reverseTacticState: false,
    showTooltipOnHover: true,
}

export type InfoviewActionKind =
    | 'toggleAllMessages'
    | 'togglePaused'
    | 'togglePin'
    | 'copyToComment'
    | 'toggleExpectedType'

export type InfoviewAction = { kind: InfoviewActionKind }

/** Interface the hosting editor uses to talk to the InfoView WebView. */
export interface InfoviewApi {
    /** Must be called exactly once on initialization with the current cursor position. */
    initialize(loc: Location): Promise<void>

    /**
     * Must fire whenever the LSP client receives a notification with a `method`
     * that has been subscribed to through {@link EditorApi.subscribeServerNotifications}.
     */
    gotServerNotification(method: string, params: any): Promise<void>

    /** Like {@link gotServerNotification}, but fires on subscribed client->server notifications. */
    sentClientNotification(method: string, params: any): Promise<void>

    /** Must fire with the server's initialization message when the server is started or restarted. */
    serverRestarted(serverInitializeResult: InitializeResult): Promise<void>
    /** Must fire with the server's message when the server is stopped. */
    serverStopped(serverStoppedReason: ServerStoppedReason | undefined): Promise<void>

    /**
     * Must fire whenever the user moves their cursor or makes a selection while in a Lean file.
     * Movements in other kinds of files must *not* fire this event. When no selection is made,
     * `loc.range.start` must equal `loc.range.end`.
     */
    // TODO maybe change Location.Range to something aware of directionality (cursor at start/end of selection)
    // TODO what to do when multiple cursors exist?
    changedCursorLocation(loc?: Location): Promise<void>

    /**
     * Must fire whenever the infoview configuration changes.
     */
    changedInfoviewConfig(conf: InfoviewConfig): Promise<void>

    /**
     * Must fire whenever the user requests that the infoview perform an action.
     */
    requestedAction(action: InfoviewAction): Promise<void>

    /**
     * Must fire whenever the user requests to go to a definition using the infoview context menu.
     * `interactiveCodeTagId` is obtainable from the `data-vscode-context` field in
     * `InteractiveCodeTag`s in the InfoView. See https://code.visualstudio.com/api/extension-guides/webview#context-menus.
     */
    goToDefinition(interactiveCodeTagId: string): Promise<void>

    /**
     * Execute the given JavaScript code inside the infoview. Must not be used
     * for anything other than testing.
     */
    runTestScript(javaScript: string): Promise<void>

    /**
     * Return the current HTML contents of the infoview as a string. This is used for testing,
     * in particular to inspect the page contents and check if the UI is in a correct state.
     */
    getInfoviewHtml(): Promise<string>
}

export interface ServerStoppedReason {
    message: string
    reason: string
}
