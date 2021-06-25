import { join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Position, Range,
    Selection, TextEditor, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace, env,
} from 'vscode';
import { TextDocumentIdentifier } from 'vscode-languageserver-protocol';
import { EditorApi, InfoviewApi } from '@lean4/infoview';
import { LeanClient } from './leanclient';
import { getInfoViewAllErrorsOnLine, getInfoViewAutoOpen, getInfoViewAutoOpenShowGoal,
    getInfoViewFilterIndex, getInfoViewStyle, getInfoViewTacticStateFilters } from './config';
import { Rpc } from './rpc';

export class InfoProvider implements Disposable {
    /** Instance of the panel. */
    private webviewPanel: WebviewPanel;
    private subscriptions: Disposable[] = [];
    private webviewRpc: Rpc;
    private webviewApi?: InfoviewApi;

    private started: boolean = false;

    private stylesheet: string = null;

    // Subscriptions are counted and only disposed when count === 0.
    private serverNotifSubscriptions: Map<string, [number, Disposable]> = new Map();
    private clientNotifSubscriptions: Map<string, [number, Disposable]> = new Map();

    private editorApi : EditorApi = {
        sendClientRequest: async <T extends TextDocumentIdentifier, U>(method: string, req: T): Promise<U> => {
            return await this.client.client.sendRequest(method, req);
        },
        subscribeServerNotifications: async (method) => {
            const el = this.serverNotifSubscriptions.get(method);
            if (el) {
                const [count, h] = el;
                this.serverNotifSubscriptions.set(method, [count + 1, h]);
                return;
            }

            // NOTE(WN): For non-custom notifications we cannot call LanguageClient.onNotification
            // here because that *ovewrites* the notification handler rather than registers an extra one.
            // So we have to add a bunch of event emitters to `LeanClient.`
            if (method.startsWith('$')) {
                const h = this.client.client.onNotification(method, (params) => {
                    void this.webviewApi.gotServerNotification(method, params);
                });
                this.serverNotifSubscriptions.set(method, [0, h]);
            } else if (method === 'textDocument/publishDiagnostics') {
                const h = this.client.diagnostics((params) => {
                    void this.webviewApi.gotServerNotification(method, params);
                });
                this.serverNotifSubscriptions.set(method, [0, h]);
            } else if (method === '$/lean/fileProgress') {
                const h = this.client.progressChanged((params) => {
                    throw new Error('unimplemented'); // TODO convert "params" to params
                    void this.webviewApi.gotServerNotification(method, params);
                });
                this.serverNotifSubscriptions.set(method, [0, h]);
            } else {
                throw new Error(`subscription to ${method} server notifications not implemented`);
            }
        },
        unsubscribeServerNotifications: async (method) => {
            const [count, h] = this.serverNotifSubscriptions.get(method);
            if (count === 1) {
                h.dispose();
                this.serverNotifSubscriptions.delete(method);
            } else {
                this.serverNotifSubscriptions.set(method, [count - 1, h])
            }
        },
        subscribeClientNotifications: async (method) => {
            const el = this.clientNotifSubscriptions.get(method);
            if (el) {
                const [count, d] = el;
                this.clientNotifSubscriptions.set(method, [count + 1, d]);
                return;
            }

            if (method === 'textDocument/didChange') {
                const h = this.client.didChange((params) => {
                    void this.webviewApi.sentClientNotification(method, params);
                });
                this.clientNotifSubscriptions.set(method, [0, h]);
            } else if (method === 'textDocument/didClose') {
                const h = this.client.didClose((params) => {
                    void this.webviewApi.sentClientNotification(method, params);
                });
                this.clientNotifSubscriptions.set(method, [0, h]);
            } else {
                throw new Error(`Subscription to '${method}' client notifications not implemented`);
            }
        },
        unsubscribeClientNotifications: async (method) => {
            const [count, h] = this.clientNotifSubscriptions.get(method);
            if (count === 1) {
                h.dispose();
                this.clientNotifSubscriptions.delete(method);
            } else {
                this.clientNotifSubscriptions.set(method, [count - 1, h])
            }
        },
        copyToClipboard: async (text) => {
            await env.clipboard.writeText(text);
            await window.showInformationMessage(`Copied to clipboard: ${text}`);
        },
        applyEdits: async (edits) => {
            throw new Error('unimplemented');
            //await this.handleInsertText(text, type, loc),
        },
        showDocument: async (show) => {
            void this.revealEditorSelection(
                Uri.parse(show.uri),
                this.client.client.protocol2CodeConverter.asRange(show.selection)
            );
        },
    };

    constructor(private client: LeanClient, private leanDocs: DocumentSelector, private context: ExtensionContext) {
        this.updateStylesheet();
        this.subscriptions.push(
            this.client.restarted(async () => {
                await this.autoOpen();
                // TODO(WN): await this.sendMessages();
            }),
            window.onDidChangeActiveTextEditor(() => this.sendPosition()),
            window.onDidChangeTextEditorSelection(() => this.sendPosition()),
            workspace.onDidChangeConfiguration(async (e) => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet();
                await this.sendConfig();
            }),
            workspace.onDidChangeTextDocument(async (e) => {
                await this.sendPosition();
            }),
            commands.registerTextEditorCommand('lean4.displayGoal', (editor) => this.openPreview(editor)),
            commands.registerTextEditorCommand('lean4.displayList', async (editor) => {
                await this.openPreview(editor);
                await this.webviewApi?.requestedAction({kind: 'toggleAllMessages'});
            }),
            commands.registerTextEditorCommand('lean4.infoView.copyToComment',
                () => this.webviewApi?.requestedAction({kind: 'copyToComment'})),
            commands.registerCommand('lean4.infoView.toggleUpdating', () =>
                this.webviewApi?.requestedAction({kind: 'togglePaused'})),
            commands.registerTextEditorCommand('lean4.infoView.toggleStickyPosition',
                () => this.webviewApi?.requestedAction({kind: 'togglePin'})),
        );
        if (this.client.isStarted()) {
            void this.autoOpen();
        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private updateStylesheet() {
        const fontFamily =
            workspace.getConfiguration('editor').get<string>('fontFamily').replace(/['"]/g, '');
        const fontCodeCSS = `
            .font-code {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
            }
        `;
        const configCSS = getInfoViewStyle();
        this.stylesheet = fontCodeCSS + configCSS;
    }

    private async autoOpen() {
        if (!this.started && getInfoViewAutoOpen()) {
            this.started = true;
            await this.openPreview(window.activeTextEditor);
        }
    }

    private async openPreview(editor: TextEditor) {
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Two;
        if (column === 4) { column = ViewColumn.Three; }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true);
        } else {
            this.webviewPanel = window.createWebviewPanel('lean4', 'Lean Infoview',
                { viewColumn: column, preserveFocus: true },
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    enableCommandUris: true,
                });
            this.webviewRpc = new Rpc((m) => this.webviewPanel.webview.postMessage(m));
            this.webviewPanel.webview.onDidReceiveMessage((m) => this.webviewRpc.messageReceived(m))
            this.webviewRpc.register(this.editorApi);
            this.webviewApi = this.webviewRpc.getApi();
            this.webviewPanel.webview.html = this.initialHtml();
            this.webviewPanel.onDidDispose(() => {
                this.webviewPanel = null;
                this.webviewRpc = null;
                this.webviewApi = null;
            });
        }
        await this.sendPosition();
        await this.sendConfig();
    }

   /* private async handleInsertText(text: string, type: string, loc?: string) {
        let editor: TextEditor = null;
        if (loc) {
           editor = window.visibleTextEditors.find(e => e.document.uri.toString() === loc.uri);
        } else {
            editor = window.activeTextEditor;
            if (!editor) { // sometimes activeTextEditor is null.
                editor = window.visibleTextEditors[0];
            }
        }
        if (!editor) return;
        const pos = loc ? this.positionOfLocation(loc) : editor.selection.active;
        if (type === 'relative') {
            // in this case, assume that we actually want to insert at the same
            // indentation level as the neighboring text
            const prev_line = editor.document.lineAt(pos.line - 1);
            const spaces = prev_line.firstNonWhitespaceCharacterIndex;
            const margin_str = [...Array(spaces).keys()].map(x => ' ').join('');

            let new_command = text.replace(/\n/g, '\n' + margin_str);
            new_command = `\n${margin_str}${new_command}`;

            await editor.edit((builder) => {
                builder.insert(prev_line.range.end, new_command);
            });
            editor.selection = new Selection(pos.line, spaces, pos.line, spaces);
        } else {
            await editor.edit((builder) => {
                builder.insert(pos, text);
            });
            editor.selection = new Selection(pos, pos)
        }
    } */

    private async sendConfig() {
       await this.webviewApi?.changedInfoviewConfig({
           infoViewTacticStateFilters: getInfoViewTacticStateFilters(),
           filterIndex: getInfoViewFilterIndex(),
           infoViewAllErrorsOnLine: getInfoViewAllErrorsOnLine(),
           infoViewAutoOpenShowGoal: getInfoViewAutoOpenShowGoal(),
       });
    }

    private async revealEditorSelection(uri: Uri, selection?: Range) {
        let editor: TextEditor = null;
        for (const e of window.visibleTextEditors) {
            if (e.document.uri.toString() === uri.toString()) {
                editor = e;
                break;
            }
        }
        if (!editor) {
            const c = window.activeTextEditor ? window.activeTextEditor.viewColumn : ViewColumn.One;
            editor = await window.showTextDocument(uri, { viewColumn: c, preserveFocus: false });
        }
        if (selection !== undefined) {
            editor.revealRange(selection, TextEditorRevealType.InCenterIfOutsideViewport);
            editor.selection = new Selection(selection.start, selection.end);
        }
    }

    private async sendPosition() {
        if (!window.activeTextEditor || !languages.match(this.leanDocs, window.activeTextEditor.document)) { return null; }
        const uri = window.activeTextEditor.document.uri;
        const selection = window.activeTextEditor.selection;
        await this.webviewApi?.changedCursorLocation({
            uri: uri.toString(),
            range: {
                start: selection.start,
                end: selection.end
            }
        });
    }

    private getMediaPath(mediaFile: string): string {
        return this.webviewPanel.webview.asWebviewUri(
            Uri.file(join(this.context.extensionPath, 'media', mediaFile))).toString();
    }

    private initialHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>Infoview</title>
                <style>${this.stylesheet}</style>
            </head>
            <body>
                <div id="react_root"></div>
                <script src="${this.getMediaPath('webview.js')}"></script>
            </body>
            </html>`
    }
}
