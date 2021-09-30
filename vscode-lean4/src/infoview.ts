import { join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Range,
    Selection, TextEditor, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace, env, Position, Diagnostic,
} from 'vscode';
import { TextDocumentIdentifier } from 'vscode-languageserver-protocol';
import { EditorApi, InfoviewApi, LeanFileProgressParams, TextInsertKind } from '@lean4/infoview';
import { LeanClient } from './leanclient';
import { getInfoViewAllErrorsOnLine, getInfoViewAutoOpen, getInfoViewAutoOpenShowGoal,
    getInfoViewFilterIndex, getInfoViewStyle, getInfoViewTacticStateFilters } from './config';
import { Rpc } from './rpc';
import { PublishDiagnosticsParams } from 'vscode-languageclient';

export class InfoProvider implements Disposable {
    /** Instance of the panel, if it is open. Otherwise `undefined`. */
    private webviewPanel?: WebviewPanel & {rpc: Rpc, api: InfoviewApi};
    private subscriptions: Disposable[] = [];

    private stylesheet: string = '';
    private autoOpened: boolean;

    // Subscriptions are counted and only disposed when count === 0.
    private serverNotifSubscriptions: Map<string, [number, Disposable]> = new Map();
    private clientNotifSubscriptions: Map<string, [number, Disposable]> = new Map();

    private editorApi : EditorApi = {
        sendClientRequest: async (method: string, params: any): Promise<any> => {
            return this.client.client.sendRequest(method, params);
        },
        sendClientNotification: async (method: string, params: any): Promise<void> => {
            void this.client.client.sendNotification(method, params);
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
            if (method === 'textDocument/publishDiagnostics') {
                const h = this.client.diagnostics((params) => {
                    void this.webviewPanel?.api.gotServerNotification(method, params);
                });
                this.serverNotifSubscriptions.set(method, [0, h]);
            } else if (method.startsWith('$')) {
                const h = this.client.customNotification(({method: thisMethod, params}) => {
                    if (thisMethod !== method) return;
                    void this.webviewPanel?.api.gotServerNotification(method, params);
                });
                this.serverNotifSubscriptions.set(method, [0, h]);
            } else {
                throw new Error(`subscription to ${method} server notifications not implemented`);
            }
        },
        unsubscribeServerNotifications: async (method) => {
            const el = this.serverNotifSubscriptions.get(method);
            if (!el) throw new Error(`trying to unsubscribe from '${method}' with no active subscriptions`);
            const [count, h] = el;
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
                    void this.webviewPanel?.api.sentClientNotification(method, params);
                });
                this.clientNotifSubscriptions.set(method, [0, h]);
            } else if (method === 'textDocument/didClose') {
                const h = this.client.didClose((params) => {
                    void this.webviewPanel?.api.sentClientNotification(method, params);
                });
                this.clientNotifSubscriptions.set(method, [0, h]);
            } else {
                throw new Error(`Subscription to '${method}' client notifications not implemented`);
            }
        },
        unsubscribeClientNotifications: async (method) => {
            const el = this.clientNotifSubscriptions.get(method);
            if (!el) throw new Error(`trying to unsubscribe from '${method}' with no active subscriptions`);
            const [count, h] = el;
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
        insertText: async (text, kind, tdpp) => {
            let uri: Uri | undefined
            let pos: Position | undefined
            if (tdpp) {
                uri = this.client.client.protocol2CodeConverter.asUri(tdpp.textDocument.uri);
                pos = this.client.client.protocol2CodeConverter.asPosition(tdpp.position);
            }
            await this.handleInsertText(text, kind, uri, pos);
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
                // NOTE(WN): We do not re-send state such as diagnostics to the infoview here
                // because a restarted server will send those on its own.
            }),
            window.onDidChangeActiveTextEditor(() => this.sendPosition()),
            window.onDidChangeTextEditorSelection(() => this.sendPosition()),
            workspace.onDidChangeConfiguration(async (_e) => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet();
                await this.sendConfig();
            }),
            workspace.onDidChangeTextDocument(async (_e) => {
                await this.sendPosition();
            }),
            commands.registerTextEditorCommand('lean4.displayGoal', (editor) => this.openPreview(editor)),
            commands.registerTextEditorCommand('lean4.displayList', async (editor) => {
                await this.openPreview(editor);
                await this.webviewPanel?.api.requestedAction({kind: 'toggleAllMessages'});
            }),
            commands.registerTextEditorCommand('lean4.infoView.copyToComment',
                () => this.webviewPanel?.api.requestedAction({kind: 'copyToComment'})),
            commands.registerCommand('lean4.infoView.toggleUpdating', () =>
                this.webviewPanel?.api.requestedAction({kind: 'togglePaused'})),
            commands.registerTextEditorCommand('lean4.infoView.toggleStickyPosition',
                () => this.webviewPanel?.api.requestedAction({kind: 'togglePin'})),
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
        if (!this.webviewPanel && !this.autoOpened && getInfoViewAutoOpen() && window.activeTextEditor) {
            // only auto-open for lean files, not for markdown.
            if (languages.match(this.leanDocs, window.activeTextEditor.document)) {
                // remember we've auto opened during this session so if user closes it it remains closed.
                this.autoOpened = true;
                await this.openPreview(window.activeTextEditor);
            }
        }
    }

    private async openPreview(editor: TextEditor) {
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Two;
        if (column === 4) { column = ViewColumn.Three; }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true);
        } else {
            const webviewPanel = window.createWebviewPanel('lean4', 'Lean Infoview',
                { viewColumn: column, preserveFocus: true },
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    enableCommandUris: true,
                }) as WebviewPanel & {rpc: Rpc, api: InfoviewApi};
            webviewPanel.rpc = new Rpc(m => webviewPanel.webview.postMessage(m));
            webviewPanel.rpc.register(this.editorApi);
            webviewPanel.webview.onDidReceiveMessage(m => webviewPanel.rpc.messageReceived(m))
            webviewPanel.api = webviewPanel.rpc.getApi();
            webviewPanel.onDidDispose(() => {
                this.webviewPanel = undefined;
            });
            this.webviewPanel = webviewPanel;
            webviewPanel.webview.html = this.initialHtml();
        }
        // The infoview listens for server notifications such as diagnostics passively,
        // so when it is first started we must re-send those as if the server did.
        await this.sendPosition();
        await this.sendConfig();
        await this.sendDiagnostics();
        await this.sendProgress();
    }

    private async sendConfig() {
       await this.webviewPanel?.api.changedInfoviewConfig({
           infoViewTacticStateFilters: getInfoViewTacticStateFilters(),
           filterIndex: getInfoViewFilterIndex(),
           infoViewAllErrorsOnLine: getInfoViewAllErrorsOnLine(),
           infoViewAutoOpenShowGoal: getInfoViewAutoOpenShowGoal(),
       });
    }

    private async sendDiagnostics() {
        if (!this.webviewPanel) return;
        this.client.client.diagnostics?.forEach(async (uri, diags) => {
            const params: PublishDiagnosticsParams = {
                uri: this.client.client.code2ProtocolConverter.asUri(uri),
                diagnostics: this.client.client.code2ProtocolConverter.asDiagnostics(diags as Diagnostic[]),
            };
            await this.webviewPanel.api.gotServerNotification('textDocument/publishDiagnostics', params);
        });
    }

    private async sendProgress() {
        if (!this.webviewPanel) return;
        for (const [uri, processing] of this.client.progress) {
            const params: LeanFileProgressParams = {
                textDocument: {
                    uri: this.client.client.code2ProtocolConverter.asUri(uri),
                    version: 0, // HACK: The infoview ignores this
                },
                processing,
            };
            await this.webviewPanel.api.gotServerNotification('$/lean/fileProgress', params);
        }
    }

    private async sendPosition() {
        if (!window.activeTextEditor || !languages.match(this.leanDocs, window.activeTextEditor.document)) { return null; }
        void this.autoOpen();
        const uri = window.activeTextEditor.document.uri;
        const selection = window.activeTextEditor.selection;
        await this.webviewPanel?.api.changedCursorLocation({
            uri: uri.toString(),
            range: {
                start: selection.start,
                end: selection.end
            }
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

    private async handleInsertText(text: string, kind: TextInsertKind, uri?: Uri, pos?: Position) {
        let editor: TextEditor | undefined
        if (uri) {
           editor = window.visibleTextEditors.find(e => e.document.uri === uri);
        } else {
            editor = window.activeTextEditor;
            if (!editor) { // sometimes activeTextEditor is null.
                editor = window.visibleTextEditors[0];
            }
        }
        if (!editor) return;
        pos = pos ? pos : editor.selection.active;
        if (kind === 'above') {
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
    }

    private getMediaPath(mediaFile: string): string {
        return this.webviewPanel?.webview.asWebviewUri(
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
