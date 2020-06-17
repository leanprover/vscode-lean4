import { readFileSync } from 'fs';
import { InfoResponse, Message, Connection } from 'lean-client-js-node';
import { basename, join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Position, Range,
    Selection, StatusBarAlignment, StatusBarItem, TextEditor,
    TextEditorDecorationType, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace,
} from 'vscode';
import { Server } from './server';
import { ToInfoviewMessage, FromInfoviewMessage, Location, InsertTextMessage, ServerRequestMessage, RevealMessage, HoverPositionMessage, locationEq } from './shared'
import { StaticServer } from './staticserver';

export class InfoProvider implements Disposable {
    /** Instance of the panel. */
    private webviewPanel: WebviewPanel;
    private proxyConnection: Connection;
    private subscriptions: Disposable[] = [];

    private statusBarItem: StatusBarItem;
    private statusShown: boolean = false;

    private started: boolean = false;
    private stopped: boolean = false;

    private pins: Location[] | null;

    private stylesheet: string = null;

    private messageFormatters: ((text: string, msg: Message) => string)[] = [];

    private hoverDecorationType: TextEditorDecorationType;
    private stickyDecorationType: TextEditorDecorationType;

    constructor(private server: Server, private leanDocs: DocumentSelector, private context: ExtensionContext, private staticServer: StaticServer) {

        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 1000);

        this.hoverDecorationType = window.createTextEditorDecorationType({
            backgroundColor: 'red', // make configurable?
            border: '3px solid red',
        });
        this.stickyDecorationType = window.createTextEditorDecorationType({
            backgroundColor: 'blue', // make configurable?
            border: '3px solid blue',
        });
        this.updateStylesheet();
        this.makeProxyConnection();
        this.subscriptions.push(
            this.server.restarted.on(() => {
                this.autoOpen();
                this.postMessage({command: 'restart'});
            }),
            window.onDidChangeActiveTextEditor(() => this.sendPosition()),
            window.onDidChangeTextEditorSelection(() => this.sendPosition()),
            workspace.onDidChangeConfiguration((e) => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet();
                this.sendConfig();
                if (!workspace.getConfiguration('lean').get('typeInStatusBar') && this.statusShown) {
                    this.statusBarItem.hide();
                    this.statusShown = false;
                }
            }),
            workspace.onDidChangeTextDocument((e) => {
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
                        return new_pin;
                    });
                    if (changed) {
                        this.postMessage({
                            command: 'sync_pin',
                            pins: this.pins,
                        });
                    }
                    this.sendPosition();
                }
            }),
            commands.registerCommand('_lean.revealPosition', this.revealEditorPosition.bind(this)),
            commands.registerCommand('_lean.infoView.pause', () => {
                this.postMessage({ command: 'pause' })
            }),
            commands.registerCommand('_lean.infoView.continue', () => {
                this.postMessage({ command: 'continue' })
            }),
            commands.registerTextEditorCommand('lean.displayGoal', (editor) => {
                this.openPreview(editor);
            }),
            commands.registerTextEditorCommand('lean.infoView.copyToComment',() =>
                this.postMessage({ command: 'copy_to_comment' })
            ),
            commands.registerCommand('lean.infoView.toggleUpdating', () => {
                this.postMessage({ command: 'toggle_updating' })
            }),
            commands.registerTextEditorCommand('lean.infoView.toggleStickyPosition', (editor) => {
                this.postMessage({ command: 'toggle_pin' })
            }),
        );
        if (this.server.alive()) {
            this.autoOpen();
        }
    }

    makeProxyConnection() {
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

    dispose() {
        this.proxyConnection.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }

    addMessageFormatter(f: (text: string, msg: Message) => string) {
        this.messageFormatters.push(f);
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

    private autoOpen() {
        if (!this.started && workspace.getConfiguration('lean').get('infoViewAutoOpen')) {
            this.started = true;
            this.openPreview(window.activeTextEditor);
        }
    }

    private openPreview(editor: TextEditor) {
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Two;
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
        this.sendPosition();
        this.sendConfig();
        this.postMessage({command: 'all_messages', messages: this.server.messages});
    }
    /** Handle a message incoming from the webview. */
    private handleMessage(message: FromInfoviewMessage) {
        switch (message.command) {
            case 'hover_position':
                this.hoverEditorPosition(message);
                return;
            case 'stop_hover':
                this.stopHover(message);
                return;
            case 'insert_text':
                this.handleInsertText(message);
                return;
            case 'server_request':
                this.handleServerRequest(message);
                return;
            case 'reveal':
                this.revealEditorPosition(Uri.parse(message.loc.file_name), message.loc.line, message.loc.column);
                return;
            case 'sync_pin':
                this.pins = message.pins;
                return;
        }
    }
    private handleServerRequest(message: ServerRequestMessage) {
        const msg = JSON.parse(message.payload);
        this.proxyConnection.send(msg);
    }
    private async handleInsertText(message: InsertTextMessage) {
        const new_command = message.text;
        let editor = null;
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
        const current_selection_range = editor.selection;
        const cursor_pos = current_selection_range.active;
        const prev_line = editor.document.lineAt(pos.line - 1);
        const spaces = prev_line.firstNonWhitespaceCharacterIndex;
        const margin_str = [...Array(spaces).keys()].map(x => ' ').join('');

        // [hack] for now, we assume that there is only ever one command per line
        // and that the command should be inserted on the line above this one.

        await editor.edit((builder) => {
            builder.insert(
                prev_line.range.end,
                `\n${margin_str}${new_command}`);
        });
        editor.selection = new Selection(pos.line, spaces, pos.line, spaces);
    }

    private positionOfLocation(l: Location): Position {
        return new Position(l.line - 1, l.column);
    }
    private makeLocation(file_name: string, pos: Position): Location {
        return {
            file_name,
            line: pos.line + 1,
            column: pos.character,
        }
    }

    private sendConfig() {
        this.postMessage({
            command: 'on_config_change',
            config: {
                infoViewTacticStateFilters: workspace.getConfiguration('lean').get('infoViewTacticStateFilters', []),
                filterIndex: workspace.getConfiguration('lean').get('infoViewFilterIndex', -1),
                infoViewAllErrorsOnLine: workspace.getConfiguration('lean').get('infoViewAllErrorsOnLine', false),
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

    private revealEditorPosition(uri: Uri, line: number, column: number) {
        for (const editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) {
                const pos = new Position(line - 1, column);
                editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenterIfOutsideViewport);
                editor.selection = new Selection(pos, pos);
            }
        }
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

    private sendPosition() {
        const loc = this.getActiveCursorLocation();
        if (loc === null) {return; }
        this.postMessage({
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
        // workaround for https://github.com/microsoft/vscode/issues/89038
        return this.staticServer.mkUri(join(this.context.extensionPath, 'media', mediaFile));
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
