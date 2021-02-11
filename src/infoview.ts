import { InfoResponse, Connection } from 'lean-client-js-node';
import { join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Position, Range,
    Selection, StatusBarAlignment, StatusBarItem, TextEditor,
    TextEditorDecorationType, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace, env,
} from 'vscode';
import { Server } from './server';
import { ToInfoviewMessage, FromInfoviewMessage, PinnedLocation, InsertTextMessage, ServerRequestMessage, RevealMessage, HoverPositionMessage, locationEq, Location, InfoViewTacticStateFilter } from './shared'
import { StaticServer } from './staticserver';

export class InfoProvider implements Disposable {
    /** Instance of the panel. */
    private webviewPanel: WebviewPanel;
    private proxyConnection: Connection;
    private subscriptions: Disposable[] = [];

    private statusBarItem: StatusBarItem;
    private statusShown: boolean = false;

    private started: boolean = false;

    private pins: PinnedLocation[] | null;

    private stylesheet: string = null;

    private hoverDecorationType: TextEditorDecorationType;

    constructor(private server: Server, private leanDocs: DocumentSelector, private context: ExtensionContext, private staticServer?: StaticServer) {

        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 1000);

        this.hoverDecorationType = window.createTextEditorDecorationType({
            backgroundColor: 'red', // make configurable?
            border: '3px solid red',
        });
        this.updateStylesheet();
        this.makeProxyConnection();
        this.subscriptions.push(
            this.server.restarted.on(async () => {
                await this.autoOpen();
                await this.postMessage({command: 'restart'});
            }),
            window.onDidChangeActiveTextEditor(() => this.sendPosition()),
            window.onDidChangeTextEditorSelection(() => this.sendPosition()),
            workspace.onDidChangeConfiguration(async (e) => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet();
                await this.sendConfig();
                if (!workspace.getConfiguration('lean').get('typeInStatusBar') && this.statusShown) {
                    this.statusBarItem.hide();
                    this.statusShown = false;
                }
            }),
            workspace.onDidChangeTextDocument(async (e) => {
                if (this.pins && this.pins.length !== 0) {
                    // stupid cursor math that should be in the vscode API
                    let changed: boolean = false;
                    this.pins = this.pins.map(pin => {
                        if (pin.file_name !== e.document.fileName) { return pin; }
                        let newPosition = this.positionOfLocation(pin);
                        for (const chg of e.contentChanges) {
                            if (newPosition.isAfterOrEqual(chg.range.start)) {
                                let lines = 0;
                            for (const c of chg.text) if (c === '\n') lines++;
                            newPosition = new Position(
                                chg.range.start.line + Math.max(0, newPosition.line - chg.range.end.line) + lines,
                                newPosition.line > chg.range.end.line ?
                                newPosition.character :
                                lines === 0 ?
                                chg.range.start.character + Math.max(0, newPosition.character - chg.range.end.character) + chg.text.length :
                                9999 // too lazy to get column positioning right, and end of the line is a good place
                                );
                            }
                        }
                        newPosition = e.document.validatePosition(newPosition);
                        const new_pin = this.makeLocation(pin.file_name, newPosition);
                        if (!locationEq(new_pin, pin)) {changed = true; }
                        return { ...new_pin, key: pin.key };
                    });
                    if (changed) {
                        await this.postMessage({
                            command: 'sync_pin',
                            pins: this.pins,
                        });
                    }
                    await this.sendPosition();
                }
            }),
            commands.registerCommand('_lean.revealPosition', this.revealEditorPosition.bind(this)),
            commands.registerCommand('_lean.infoView.pause', () => this.postMessage({ command: 'pause' })),
            commands.registerCommand('_lean.infoView.continue', () => this.postMessage({ command: 'continue' })),
            commands.registerTextEditorCommand('lean.displayGoal', (editor) => this.openPreview(editor)),
            commands.registerTextEditorCommand('lean.displayList', async (editor) => {
                await this.openPreview(editor);
                await this.postMessage({ command: 'toggle_all_messages' });
            }),
            commands.registerTextEditorCommand('lean.infoView.copyToComment',() =>
                this.postMessage({ command: 'copy_to_comment' })
            ),
            commands.registerCommand('lean.infoView.toggleUpdating', () => this.postMessage({ command: 'toggle_updating' })),
            commands.registerTextEditorCommand('lean.infoView.toggleStickyPosition', () => this.postMessage({ command: 'toggle_pin' })),
        );
        if (this.server.alive()) {
            void this.autoOpen();
        }
    }

    private makeProxyConnection() {
        if (this.proxyConnection) {
            this.proxyConnection.dispose();
        }
        this.proxyConnection = this.server.makeProxyTransport().connect();
        this.subscriptions.push(
            this.proxyConnection.error.on(e =>
                this.postMessage({
                    command: 'server_error',
                    payload: JSON.stringify(e)
                })
            ),
            this.proxyConnection.jsonMessage.on(e =>
                this.postMessage({
                    command: 'server_event',
                    payload: JSON.stringify(e)
                })
            )
        );

    }

    dispose(): void {
        this.proxyConnection.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }

    private updateStylesheet() {
        const fontFamily =
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            (workspace.getConfiguration('editor').get('fontFamily') as string).
                replace(/['"]/g, '');
        const fontCodeCSS = `
            .font-code {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
            }
        `;
        const configCSS = workspace.getConfiguration('lean').get('infoViewStyle');
        this.stylesheet = fontCodeCSS + configCSS;
    }

    private async autoOpen() {
        if (!this.started && workspace.getConfiguration('lean').get('infoViewAutoOpen')) {
            this.started = true;
            await this.openPreview(window.activeTextEditor);
        }
    }

    private async openPreview(editor: TextEditor) {
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Two;
        const loc = this.getActiveCursorLocation();
        if (column === 4) { column = ViewColumn.Three; }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true);
        } else {
            this.webviewPanel = window.createWebviewPanel('lean', 'Lean Infoview',
                { viewColumn: column, preserveFocus: true },
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    enableCommandUris: true,
                });
            this.webviewPanel.webview.html = this.initialHtml();
            this.webviewPanel.onDidDispose(() => this.webviewPanel = null);
            this.webviewPanel.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.subscriptions);
        }
        if (loc !== null) { await this.postMessage({ command: 'position', loc }); }
        await this.sendConfig();
        await this.postMessage({command: 'all_messages', messages: this.server.messages});
    }
    /** Handle a message incoming from the webview. */
    private async handleMessage(message: FromInfoviewMessage) {
        switch (message.command) {
            case 'hover_position':
                this.hoverEditorPosition(message);
                return;
            case 'stop_hover':
                this.stopHover(message);
                return;
            case 'insert_text':
                await this.handleInsertText(message);
                return;
            case 'copy_text':
                await env.clipboard.writeText(message.text);
                await window.showInformationMessage(`Copied to clipboard: ${message.text}`);
                return;
            case 'server_request':
                this.handleServerRequest(message);
                return;
            case 'reveal':
                await this.revealEditorPosition(Uri.file(message.loc.file_name), message.loc.line, message.loc.column);
                return;
            case 'sync_pin':
                this.pins = message.pins;
                return;
            case 'request_config':
                await this.sendConfig();
                await this.postMessage({command: 'all_messages', messages: this.server.messages});
                return;
        }
    }
    private handleServerRequest(message: ServerRequestMessage) {
        this.proxyConnection.send(JSON.parse(message.payload));
    }
    private async handleInsertText(message: InsertTextMessage) {
        let editor: TextEditor = null;
        if (message.loc) {
           editor = window.visibleTextEditors.find(e => e.document.fileName === message.loc.file_name);
        } else {
            editor = window.activeTextEditor;
            if (!editor) { // sometimes activeTextEditor is null.
                editor = window.visibleTextEditors[0];
            }
        }
        if (!editor) {return; }
        const pos = message.loc ? this.positionOfLocation(message.loc) : editor.selection.active;
        const insert_type = message.insert_type ?? 'relative';
        if (insert_type === 'relative') {
            // in this case, assume that we actually want to insert at the same
            // indentation level as the neighboring text
            const current_selection_range = editor.selection;
            const cursor_pos = current_selection_range.active;
            const prev_line = editor.document.lineAt(pos.line - 1);
            const spaces = prev_line.firstNonWhitespaceCharacterIndex;
            const margin_str = [...Array(spaces).keys()].map(x => ' ').join('');

            let new_command = message.text.replace(/\n/g, '\n' + margin_str);
            new_command = `\n${margin_str}${new_command}`;

            await editor.edit((builder) => {
                builder.insert(prev_line.range.end, new_command);
            });
            editor.selection = new Selection(pos.line, spaces, pos.line, spaces);
        } else {
            await editor.edit((builder) => {
                builder.insert(pos, message.text);
            });
            editor.selection = new Selection(pos, pos)
        }
    }

    private positionOfLocation(l: Location): Position {
        return new Position(l.line - 1, l.column ?? 0);
    }
    private makeLocation(file_name: string, pos: Position): Location {
        return {
            file_name,
            line: pos.line + 1,
            column: pos.character,
        }
    }

    private async sendConfig() {
        await this.postMessage({
            command: 'on_config_change',
            config: {
                infoViewTacticStateFilters: (workspace.getConfiguration('lean').get('infoViewTacticStateFilters', []) as InfoViewTacticStateFilter[]),
                filterIndex: workspace.getConfiguration('lean').get('infoViewFilterIndex', -1),
                infoViewAllErrorsOnLine: workspace.getConfiguration('lean').get('infoViewAllErrorsOnLine', false),
                infoViewAutoOpenShowGoal: workspace.getConfiguration('lean').get('infoViewAutoOpenShowGoal', true)
            },
        });
    }

    private async postMessage(msg: ToInfoviewMessage): Promise<boolean> {
        if (this.webviewPanel) {
            return this.webviewPanel.webview.postMessage(msg);
        } else {
            return false;
        }
    }

    private async revealEditorPosition(uri: Uri, line: number, column: number) {
        const pos = new Position(line - 1, column);
        let editor = null;
        for (const e of window.visibleTextEditors) {
            if (e.document.uri.toString() === uri.toString()) {
                editor = e;
                break;
            }
        }
        if (!editor) {
            const c = window.activeTextEditor ? window.activeTextEditor.viewColumn : ViewColumn.One;
            const td = await workspace.openTextDocument(uri);
            editor = await window.showTextDocument(td, c, false);
        }
        editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenterIfOutsideViewport);
        editor.selection = new Selection(pos, pos);
        return;
    }

    private hoverEditorPosition(message: HoverPositionMessage) {
        const {file_name, line, column} = message.loc;
        const endLine = line; // [todo]
        const endColumn = column;
        for (const editor of window.visibleTextEditors) {
            if (editor.document.uri.path === file_name) {
                const pos = new Position(line - 1, column);
                const endPos = new Position(endLine - 1, endColumn);
                const range = new Range(pos, endPos);
                editor.setDecorations(this.hoverDecorationType, [range]);
            }
        }
    }

    private stopHover(message) {
        for (const editor of window.visibleTextEditors) {
            if (editor.document.languageId === 'lean') {
                editor.setDecorations(this.hoverDecorationType, []);
            }
        }
    }

    private async sendPosition() {
        const loc = this.getActiveCursorLocation();
        if (loc === null) {return; }
        await this.postMessage({
            command: 'position',
            loc,
        });
    }

    private getActiveCursorLocation(): Location | null {
        if (!window.activeTextEditor || !languages.match(this.leanDocs, window.activeTextEditor.document)) {return null; }
        return this.makeLocation(window.activeTextEditor.document.fileName, window.activeTextEditor.selection.active);
    }

    private updateTypeStatus(info: InfoResponse) {
        if (!this.statusShown) {
            this.statusBarItem.show();
            this.statusShown = true;
        }
        if (info.record) {
            const name = info.record['full-id'] || info.record.text;
            if (name && !info.record.tactic_params) {
                this.statusBarItem.text = name + ' : ' + info.record.type;
            }
        }
    }

    private getMediaPath(mediaFile: string): string {
        if (this.staticServer) {
            // workaround for https://github.com/microsoft/vscode/issues/89038
            return this.staticServer.mkUri(join(this.context.extensionPath, 'media', mediaFile));
        } else {
            return this.webviewPanel.webview.asWebviewUri(
                Uri.file(join(this.context.extensionPath, 'media', mediaFile))).toString();
        }
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
                <script src="${this.getMediaPath('index.js')}"></script>
            </body>
            </html>`
    }
}
