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
import { DisplayMode, WidgetEventMessage, ToInfoviewMessage, InfoProps, ServerStatus, FromInfoviewMessage, InfoViewState, Location, Config, InsertTextMessage, ServerRequestMessage } from './typings'
import { StaticServer } from './staticserver';

export class InfoProvider implements Disposable {
    /** Instance of the panel. */
    private webviewPanel: WebviewPanel;
    private proxyConnection: Connection;
    private subscriptions: Disposable[] = [];

    private displayMode: DisplayMode = DisplayMode.AllMessage;

    private statusBarItem: StatusBarItem;
    private statusShown: boolean = false;

    private started: boolean = false;
    private stopped: boolean = false;
    private curFileName: string = null;
    private curPosition: Position = null;
    private stylesheet: string = null;

    private messageFormatters: ((text: string, msg: Message) => string)[] = [];

    private hoverDecorationType: TextEditorDecorationType;

    constructor(private server: Server, private leanDocs: DocumentSelector, private context: ExtensionContext, private staticServer: StaticServer) {

        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 1000);

        this.hoverDecorationType = window.createTextEditorDecorationType({
            backgroundColor: 'red', // make configurable?
            border: '3px solid red',
        });
        this.updateStylesheet();
        this.proxyConnection = this.server.makeProxyConnection();
        this.subscriptions.push(
            this.server.restarted.on(() => {
                this.autoOpen();
            }),
            window.onDidChangeActiveTextEditor(() => this.updatePosition(false)),
            window.onDidChangeTextEditorSelection(() => this.updatePosition(false)),
            workspace.onDidChangeConfiguration((e) => {
                // regression; changing the style needs a reload. :/
                this.updateStylesheet();
                this.sendConfig();
                if (!workspace.getConfiguration('lean').get('typeInStatusBar') && this.statusShown) {
                    this.statusBarItem.hide();
                    this.statusShown = false;
                }
            }),
            commands.registerCommand('_lean.revealPosition', this.revealEditorPosition.bind(this)),
            // commands.registerCommand('_lean.infoView.pause', () => {
            //     this.stopUpdating();
            // }),
            // commands.registerCommand('_lean.infoView.continue', () => {
            //     this.setMode(this.displayMode);
            // }),
            commands.registerTextEditorCommand('lean.displayGoal', (editor) => {
                // this.setMode(DisplayMode.OnlyState);
                this.openPreview(editor);
            }),
            commands.registerTextEditorCommand('lean.displayList', (editor) => {
                // this.setMode(DisplayMode.AllMessage);
                this.openPreview(editor);
            }),
            // commands.registerTextEditorCommand('lean.infoView.displayGoal', (editor) => {
            //     this.setMode(DisplayMode.OnlyState);
            // }),
            // commands.registerTextEditorCommand('lean.infoView.displayList', (editor) => {
            //     this.setMode(DisplayMode.AllMessage);
            // }),
            // commands.registerTextEditorCommand('lean.infoView.copyToComment',
            //     (editor) => this.copyToComment(editor)),
            // commands.registerTextEditorCommand('lean.infoView.toggleUpdating', (editor) => {
            //     if (this.stopped) {
            //         this.setMode(this.displayMode);
            //     } else {
            //         this.stopUpdating();
            //     }
            // }),
            this.proxyConnection,
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
            ),
        );
        if (this.server.alive()) {
            this.autoOpen();
        }
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
    }

    addMessageFormatter(f: (text: string, msg: Message) => string) {
        this.messageFormatters.push(f);
    }

    private updateStylesheet() {
        const css = this.context.asAbsolutePath(join('media', 'infoview.css'));
        const fontFamily =
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            (workspace.getConfiguration('editor').get('fontFamily') as string).
                replace(/['"]/g, '');
        const styleSheetOld = readFileSync(css, 'utf-8');
        const fontCodeCSS = `
            .font-code {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
            }
        `;
        const configCSS = workspace.getConfiguration('lean').get('infoViewStyle');
        this.stylesheet = /* styleSheetOld + */ fontCodeCSS + configCSS;
    }

    private autoOpen() {
        if (!this.started && workspace.getConfiguration('lean').get('infoViewAutoOpen')) {
            this.started = true;
            this.setMode(
                workspace.getConfiguration('lean').get('infoViewAutoOpenShowGoal', true) ?
                    DisplayMode.OnlyState : DisplayMode.AllMessage);
            this.openPreview(window.activeTextEditor);
            this.updatePosition(false);
            this.sendConfig();
        }
    }

    private openPreview(editor: TextEditor) {
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Two;
        if (column === 4) { column = ViewColumn.Three; }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true);
        } else {
            this.webviewPanel = window.createWebviewPanel('lean',
                this.displayMode === DisplayMode.OnlyState ? 'Lean Goal' : 'Lean Messages',
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
    }
    /** Handle a message incoming from the webview. */
    private handleMessage(message: FromInfoviewMessage) {
        switch (message.command) {
            // case 'selectFilter':
            //     workspace.getConfiguration('lean').update('infoViewFilterIndex',
            //         message.filterId, true);
            //     // the workspace configuration change already forces a rerender
            //     return;
            // case 'hoverPosition':
            //     this.hoverEditorPosition(message.data[0], message.data[1], message.data[2],
            //         message.data[3], message.data[4]);
            //     return;
            // case 'stopHover':
            //     this.stopHover();
            //     return;
            case 'insert_text':
                this.handleInsertText(message);
                return;
            case 'server_request':
                this.handleServerRequest(message);
                return;
            case 'reveal':
                this.revealEditorPosition(Uri.parse(message.loc.file_name), message.loc.line, message.loc.column);
                return;
            // case 'widget_event':
            //     this.handleWidgetEvent(message);
            //     return;
            // case 'set_pin':
            //     this.pins.push({...message});
            //     return;
            // case 'unset_pin':
            //     this.pins.filter(x => !(
            //         x.file_name === message.file_name &&
            //         x.line === message.line &&
            //         x.column === message.column));
            //     return;
        }
    }
    private handleServerRequest(message: ServerRequestMessage) {
        const msg = JSON.parse(message.payload);
        this.proxyConnection.send(msg);
    }
    private async handleInsertText(message: InsertTextMessage) {
        const new_command = message.text;
        for (const editor of window.visibleTextEditors) {
            if (editor.document.fileName === message.loc.file_name) {
                const current_selection_range = editor.selection;
                const cursor_pos = current_selection_range.active;
                const prev_line = editor.document.lineAt(message.loc.line - 2);
                const spaces = prev_line.firstNonWhitespaceCharacterIndex;
                const margin_str = [...Array(spaces).keys()].map(x => ' ').join('');

                // [hack] for now, we assume that there is only ever one command per line
                // and that the command should be inserted on the line above this one.

                await editor.edit((builder) => {
                    builder.insert(
                        prev_line.range.end,
                        `\n${margin_str}${new_command}, `);
                });
                editor.selection = new Selection(message.loc.line, spaces, message.loc.line, spaces);
            }
        }
    }

    /** post a position message to the infoview. */
    private sendPosition() {
        this.postMessage({
            command: 'position',
            loc : {
                file_name: this.curFileName,
                line: this.curPosition.line + 1,
                column: this.curPosition.character,
            }
        });
    }
    private sendConfig() {
        this.postMessage({
            command: 'on_config_change',
            config: {
                infoViewTacticStateFilters: workspace.getConfiguration('lean').get('infoViewTacticStateFilters', []),
                filterIndex: workspace.getConfiguration('lean').get('infoViewFilterIndex', -1),
                infoViewAllErrorsOnLine: workspace.getConfiguration('lean').get('infoViewAllErrorsOnLine', false),
                displayMode: this.displayMode,
            },
        });
    }

    private setMode(mode: DisplayMode) {
        if (this.displayMode === mode && !this.stopped) { return; }
        this.displayMode = mode;
        if (this.webviewPanel) {
            this.webviewPanel.title = this.displayMode === DisplayMode.OnlyState ? 'Lean Goal' : 'Lean Messages';
        }
        this.stopped = false;
        this.updatePosition(true);
        this.sendConfig();
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

    private hoverEditorPosition(uri: string, line: number, column: number,
        endLine: number, endColumn: number) {
        for (const editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri) {
                const pos = new Position(line - 1, column);
                const endPos = new Position(endLine - 1, endColumn);
                const range = new Range(pos, endPos);
                editor.setDecorations(this.hoverDecorationType, [range]);
            }
        }
    }

    private stopHover() {
        for (const editor of window.visibleTextEditors) {
            if (editor.document.languageId === 'lean') {
                editor.setDecorations(this.hoverDecorationType, []);
            }
        }
    }

    private changePosition() {
        if (!window.activeTextEditor ||
            !languages.match(this.leanDocs, window.activeTextEditor.document)) {
            return;
        }

        const oldFileName = this.curFileName;
        const oldPosition = this.curPosition;

        this.curFileName = window.activeTextEditor.document.fileName;
        this.curPosition = window.activeTextEditor.selection.active;

        return (this.curFileName !== oldFileName || !this.curPosition.isEqual(oldPosition));
    }

    private async updatePosition(forceRefresh: boolean) {
        if (this.stopped) { return; }

        const chPos = this.changePosition();
        if (!chPos && !forceRefresh) {
            return;
        }

        // clear type in status bar item
        this.statusBarItem.text = '';

        /* updateTypeStatus is only called from the cases of the following switch-block, so pausing
           live-updates to the infoview (via this.stopped) also pauses the type status bar item */
        switch (this.displayMode) {
            case DisplayMode.OnlyState:
                const chGoal = await this.updateGoal();
                if (chPos || chGoal || chMsg) {
                    this.rerender();
                } else if (forceRefresh) {
                    this.postMessage({ command: 'continue' });
                }
                break;

            case DisplayMode.AllMessage:
                if (workspace.getConfiguration('lean').get('typeInStatusBar')) {
                    const info = await this.server.info(
                        this.curFileName, this.curPosition.line + 1, this.curPosition.character);
                    this.updateTypeStatus(info);
                }
                if (forceRefresh || chMsg) {
                    this.rerender();
                } else {
                    this.sendPosition();
                }
                break;
        }
    }

    private getLocation(): Location {
        return {
            file_name: this.curFileName,
            line: this.curPosition.line + 1,
            column: this.curPosition.character
        };
    }

    private toInfoProps(l: Location, m: InfoResponse): InfoProps {
        const record: any = m.record;
        return {
            widget: record && record.widget ? JSON.stringify(record.widget) : undefined, // [note] there is a bug in vscode where the whole window will irrecoverably hang if the json depth is too high.
            goalState: record && record.state,
            ...l,
            location_name: `${Uri.file(l.file_name)}:${this.curPosition.line}:${this.curPosition.character}`,
            base_name: basename(l.file_name),
        }
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

    // private async copyToComment(editor: TextEditor) {
    //     await editor.edit((builder) => {
    //         builder.insert(editor.selection.end.with({ character: 0 }).translate({ lineDelta: 1 }),
    //             '/-\n' + this.renderText() + '\n-/\n');
    //     });
    // }
    // private renderText(): string {
    //     const msgText = this.curMessages &&
    //         this.curMessages.map((m) =>
    //             `${basename(m.file_name)}:${m.pos_line}:${m.pos_col}: ${m.severity} ${m.caption}\n${m.text}`,
    //         ).join('\n');
    //     const goalText = this.curGoalState ? `Tactic State:\n${this.curGoalState}\n` : '';
    //     return goalText + msgText;
    // }
}
