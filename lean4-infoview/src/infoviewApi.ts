import { InitializeResult, Location, ShowDocumentParams, TextDocumentPositionParams } from "vscode-languageserver-protocol"

export interface EditorFsApi {
  stat(path: string): Promise<any>;
  read(path: string): Promise<Uint8Array>;
}

/**
 * An insert `here` should be written exactly at the specified position,
 * while one `above` should go on the preceding line.
 */
export type TextInsertKind = 'here' | 'above';

/** Functionality which the hosting editor must provide to the infoview. */
export interface EditorApi {
  // NOTE: not needed as of now.
  //fs : EditorFsApi;

  /** Make a request to the LSP server. */
  sendClientRequest(method: string, params: any): Promise<any>;
  /** Send a notification to the LSP server. */
  sendClientNotification(method: string, params: any): Promise<void>;

  /**
   * Subscribe to notifications from the LSP server with the specified `method`.
   * Notifications which have been subscribed to will be fired through {@link InfoviewApi.gotServerNotification}.
   * This may be called multiple times, in which case the editor must count the subscriptions and only
   * stop firing events when `unsubscribe` has been called the same amount of times.
   */
  subscribeServerNotifications(method: string): Promise<void>;
  unsubscribeServerNotifications(method: string): Promise<void>;

  /**
   * Like {@link subscribeServerNotifications}, but for client->server notifications.
   */
  subscribeClientNotifications(method: string): Promise<void>;
  unsubscribeClientNotifications(method: string): Promise<void>;

  /** Put `text` in the user's clipboard. */
  copyToClipboard(text: string): Promise<void>;

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

  /** Highlight a range in a document in the editor. */
  showDocument(show: ShowDocumentParams): Promise<void>;
}

export interface InfoviewTacticStateFilter {
    name?: string;
    regex: string;
    match: boolean;
    flags: string;
}

export interface InfoviewConfig {
    filterIndex: number;
    infoViewTacticStateFilters: InfoviewTacticStateFilter[];
    infoViewAllErrorsOnLine: boolean;
    infoViewAutoOpenShowGoal: boolean;
}

export const defaultInfoviewConfig: InfoviewConfig = {
    filterIndex: -1,
    infoViewTacticStateFilters: [],
    infoViewAllErrorsOnLine: true,
    infoViewAutoOpenShowGoal: true,
}

export type InfoviewAction =
  { kind: 'toggleAllMessages'} |
  { kind: 'togglePaused' } |
  { kind: 'togglePin'} |
  { kind: 'copyToComment'}

/** Calls which the hosting editor must make when the corresponding events occur. */
export interface InfoviewApi {
  /** Must be called exactly once on initialization with the server initialization message. */
  initialize(serverInitializeResult: InitializeResult): Promise<void>;

  /**
   * Must fire whenever the LSP client receives a notification with a `method`
   * that has been subscribed to through {@link EditorApi.subscribeServerNotifications}.
   */
  gotServerNotification(method: string, params: any): Promise<void>;

  /** Like {@link gotServerNotification}, but fires on subscribed client->server notifications. */
  sentClientNotification(method: string, params: any): Promise<void>;

  /**
   * Must fire whenever the user moves their cursor or makes a selection while in a Lean file.
   * Movements in other kinds of files must *not* fire this event. When no selection is made,
   * `loc.range.start` must equal `loc.range.end`.
   */
  // TODO maybe change Location.Range to something aware of directionality (cursor at start/end of selection)
  // TODO what to do when multiple cursors exist?
  changedCursorLocation(loc?: Location): Promise<void>;

  /**
   * Must fire whenever the infoview configuration changes.
   */
  changedInfoviewConfig(conf: InfoviewConfig): Promise<void>;

  /**
   * Must fire whenever the user requests that the infoview perform an action.
   */
  requestedAction(action: InfoviewAction): Promise<void>;
}
