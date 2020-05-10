import { readFileSync } from 'fs';
import { InfoResponse, Message } from 'lean-client-js-node';
import { basename, join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Position, Range,
    Selection, StatusBarAlignment, StatusBarItem, TextEditor,
    TextEditorDecorationType, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace,
} from 'vscode';
import { Server } from './server';
import { DisplayMode, WidgetEventMessage, InfoviewMessage, InfoProps } from './typings'

function compareMessages(m1: Message, m2: Message): boolean {
    return (m1.file_name === m2.file_name &&
        m1.pos_line === m2.pos_line && m1.pos_col === m2.pos_col &&
        m1.severity === m2.severity && m1.caption === m2.caption && m1.text === m2.text);
}

// https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


interface WidgetEventResponseSuccess {
    status: 'success';
    widget: any;
}
interface WidgetEventResponseEdit {
    status: 'edit';
    widget: any;
    /** Some text to insert after the widget's comma. */
    action: string;
}
interface WidgetEventResponseInvalid {
    status: 'invalid_handler';
}
interface WidgetEventResponseError {
    status: 'error';
    message: string;
}
type WidgetEventResponse = WidgetEventResponseSuccess | WidgetEventResponseInvalid | WidgetEventResponseEdit | WidgetEventResponseError

export class InfoProvider implements Disposable {
    /** Instance of the panel. */
    private webviewPanel: WebviewPanel;
    private subscriptions: Disposable[] = [];

    private displayMode: DisplayMode = DisplayMode.AllMessage;

    private statusBarItem: StatusBarItem;
    private statusShown: boolean = false;

    private started: boolean = false;
    private stopped: boolean = false;
    private curFileName: string = null;
    private curPosition: Position = null;
    private curGoalState: string = null;
    private curMessages: Message[] = null;
    private curWidget: any = null;

    private stylesheet: string = null;

    private messageFormatters: ((text: string, msg: Message) => string)[] = [];

    private hoverDecorationType: TextEditorDecorationType;

    constructor(
        private server: Server,
        private leanDocs: DocumentSelector,
        private context: ExtensionContext) {

        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 1000);

        this.hoverDecorationType = window.createTextEditorDecorationType({
            backgroundColor: 'red', // make configurable?
            border: '3px solid red',
        });
        this.updateStylesheet();
        this.subscriptions.push(
            this.server.allMessages.on(() => {
                if (this.updateMessages()) { this.rerender(); }
            }),
            this.server.statusChanged.on(async () => {
                if (this.displayMode === DisplayMode.OnlyState) {
                    const changed = await this.updateGoal();
                    if (changed) { this.rerender(); }
                }
            }),
            this.server.restarted.on(() => {
                this.autoOpen();
            }),
            window.onDidChangeActiveTextEditor(() => this.updatePosition(false)),
            window.onDidChangeTextEditorSelection(() => this.updatePosition(false)),
            workspace.onDidChangeConfiguration((e) => {
                this.updateStylesheet();
                this.rerender();
                if (!workspace.getConfiguration('lean').get('typeInStatusBar') && this.statusShown) {
                    this.statusBarItem.hide();
                    this.statusShown = false;
                }
            }),
            commands.registerCommand('_lean.revealPosition', (x,y,z) => this.revealEditorPosition(x,y,z)),
            commands.registerCommand('_lean.infoView.pause', () => {
                this.stopUpdating();
            }),
            commands.registerCommand('_lean.infoView.continue', () => {
                this.setMode(this.displayMode);
            }),
            commands.registerTextEditorCommand('lean.displayGoal', (editor) => {
                this.setMode(DisplayMode.OnlyState);
                this.openPreview(editor);
            }),
            commands.registerTextEditorCommand('lean.displayList', (editor) => {
                this.setMode(DisplayMode.AllMessage);
                this.openPreview(editor);
            }),
            commands.registerTextEditorCommand('lean.infoView.displayGoal', (editor) => {
                this.setMode(DisplayMode.OnlyState);
            }),
            commands.registerTextEditorCommand('lean.infoView.displayList', (editor) => {
                this.setMode(DisplayMode.AllMessage);
            }),
            commands.registerTextEditorCommand('lean.infoView.copyToComment',
                (editor) => this.copyToComment(editor)),
            commands.registerTextEditorCommand('lean.infoView.toggleUpdating', (editor) => {
                if (this.stopped) {
                    this.setMode(this.displayMode);
                } else {
                    this.stopUpdating();
                }
            }),
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
        let fontFamily: string = workspace.getConfiguration('editor').get('fontFamily');
        fontFamily = fontFamily.replace(/['"]/g, '');
        this.stylesheet = readFileSync(css, 'utf-8') + `
            .font-code {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
            }
            ` +
            workspace.getConfiguration('lean').get('infoViewStyle');
    }

    private autoOpen() {
        if (!this.started && workspace.getConfiguration('lean').get('infoViewAutoOpen')) {
            this.started = true;
            this.setMode(
                workspace.getConfiguration('lean').get('infoViewAutoOpenShowGoal', true) ?
                    DisplayMode.OnlyState : DisplayMode.AllMessage);
            this.openPreview(window.activeTextEditor);
            this.updatePosition(false);
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
    private handleMessage(message) {
        switch (message.command) {
            case 'selectFilter':
                workspace.getConfiguration('lean').update('infoViewFilterIndex',
                    message.filterId, true);
                // the workspace configuration change already forces a rerender
                return;
            case 'hoverPosition':
                this.hoverEditorPosition(message.data[0], message.data[1], message.data[2],
                    message.data[3], message.data[4]);
                return;
            case 'stopHover':
                this.stopHover();
                return;
            case 'widget_event':
                this.handleWidgetEvent(message);
                return;
        }
    }

    /** Runs whenever the user interacts with a widget. */
    private async handleWidgetEvent(message: WidgetEventMessage) {
        console.log('got widget event', message);
        message = {
            command: 'widget_event',
            file_name: this.curFileName,
            line: this.curPosition.line + 1,
            column: this.curPosition.character,
            ...message,
        }
        const result: any = await this.server.send(message);
        console.log('recieved from server', result);
        if (!result.record) { return; }
        const record: WidgetEventResponse = result.record;
        if (record.status === 'success' && record.widget) {
            this.curWidget = record.widget;
            this.rerender();
        } else if (record.status === 'edit') {
            const new_command: string = record.action;
            this.curWidget = record.widget;
            for (const editor of window.visibleTextEditors) {
                if (editor.document.fileName === message.file_name) {
                    const current_selection_range = editor.selection;
                    const cursor_pos = current_selection_range.active;
                    const prev_line = editor.document.lineAt(message.line - 2);
                    const spaces = prev_line.firstNonWhitespaceCharacterIndex;
                    const margin_str = [...Array(spaces).keys()].map(x => ' ').join('');

                    // [hack] for now, we assume that there is only ever one command per line
                    // and that the command should be inserted on the line above this one.

                    await editor.edit((builder) => {
                        builder.insert(
                            prev_line.range.end,
                            `\n${margin_str}${new_command}, `);
                    });
                    editor.selection = new Selection(message.line, spaces, message.line, spaces);
                }
            }

        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for {${message.handler}, ${message.route}}: invalid handler.`)
            await this.updateGoal();
            this.rerender();
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message}`);
        }
    }

    /** post a position message to the webserver. */
    private sendPosition() {
        this.postMessage({
            command: 'position',
            fileName: this.curFileName,
            line: this.curPosition.line + 1,
            column: this.curPosition.character,
        });
    }

    private stopUpdating() {
        this.stopped = true;
        this.postMessage({ command: 'pause' });
    }

    private rerender() {
        if (this.webviewPanel) {
            const infoViewTacticStateFilters = workspace.getConfiguration('lean').get('infoViewTacticStateFilters', []);
            const filterIndex = workspace.getConfiguration('lean').get('infoViewFilterIndex', -1);
            const cursorInfo: InfoProps = {
                widget: this.curWidget ? JSON.stringify(this.curWidget) : undefined, // [note] there is a bug in vscode where the whole window will irrecoverably hang if the json depth is too high.
                goalState: this.curGoalState,
                messages: this.curMessages,
                fileName: this.curFileName,
                displayMode: this.displayMode,
                filterIndex,
                infoViewTacticStateFilters,
                line: this.curPosition.line, column: this.curPosition.character,
                location_name: `${Uri.file(this.curFileName)}:${this.curPosition.line}:${this.curPosition.character}`,
                base_name: basename(this.curFileName),
            }

            this.postMessage({
                command: 'sync',
                props: {
                    cursorInfo,
                    pinnedInfos: [],
                }
            });
        }
    }

    private setMode(mode: DisplayMode) {
        if (this.displayMode === mode && !this.stopped) { return; }
        this.displayMode = mode;
        if (this.webviewPanel) {
            this.webviewPanel.title = this.displayMode === DisplayMode.OnlyState ? 'Lean Goal' : 'Lean Messages';
        }
        this.stopped = false;
        this.updatePosition(true);
    }

    private async postMessage(msg: InfoviewMessage): Promise<boolean> {
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

        const chMsg = this.updateMessages();
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

    private updateMessages(): boolean {
        if (this.stopped || !this.curFileName) { return false; }
        let msgs: Message[];
        switch (this.displayMode) {
            case DisplayMode.OnlyState:
                /* Heuristic: find first position to the left which has messages attached,
                   from that on show all messages in this line */
                msgs = this.server.messages
                    .filter((m) => m.file_name === this.curFileName &&
                        m.pos_line === this.curPosition.line + 1)
                    .sort((a, b) => a.pos_col - b.pos_col);
                if (!workspace.getConfiguration('lean').get('infoViewAllErrorsOnLine')) {
                    let startColumn;
                    let startPos = null;
                    for (let i = 0; i < msgs.length; i++) {
                        if (this.curPosition.character < msgs[i].pos_col) { break; }
                        if (this.curPosition.character === msgs[i].pos_col) {
                            startColumn = this.curPosition.character;
                            startPos = i;
                            break;
                        }
                        if (startColumn == null || startColumn < msgs[i].pos_col) {
                            startColumn = msgs[i].pos_col;
                            startPos = i;
                        }
                    }
                    if (startPos) {
                        msgs = msgs.slice(startPos);
                    }
                }
                break;

            case DisplayMode.AllMessage:
                msgs = this.server.messages
                    .filter((m) => m.file_name === this.curFileName)
                    .sort((a, b) => a.pos_line === b.pos_line
                        ? a.pos_col - b.pos_col
                        : a.pos_line - b.pos_line);
                break;
        }
        if (!this.curMessages) {
            this.curMessages = msgs;
            return true;
        }
        const oldMsgs = this.curMessages;
        if (msgs.length === oldMsgs.length) {
            let eq = true;
            for (let i = 0; i < msgs.length; i++) {
                if (!compareMessages(msgs[i], oldMsgs[i])) {
                    eq = false;
                    break;
                }
            }
            if (eq) { return false; }
        }
        this.curMessages = msgs;
        return true;
    }

    private async updateGoal(): Promise<boolean> {
        if (this.stopped || !this.curFileName || !this.curPosition) { return false; }
        let shouldUpdate = false;
        try {
            // get the 'save_info' format for this location.
            const info = await this.server.info(
                this.curFileName, this.curPosition.line + 1, this.curPosition.character);
            const record: any = info.record;
            if (record && record.widget) {
                this.curWidget = record.widget;
                console.log('Found a widget');
                console.log(record);
                shouldUpdate = true;
            } else {
                this.curWidget = null;
            }
            if (info.record && info.record.state) {
                if (this.curGoalState !== info.record.state) {
                    this.curGoalState = info.record.state;
                    shouldUpdate = true;
                }
            }
            else {
                if (this.curGoalState) {
                    this.curGoalState = null;
                }
            }
            if (workspace.getConfiguration('lean').get('typeInStatusBar')) {
                this.updateTypeStatus(info);
            }
            return shouldUpdate;
        } catch (e) {
            if (e !== 'interrupted') { throw e; }
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
        return Uri.file(this.context.asAbsolutePath(join('media', mediaFile)))
            .with({ scheme: 'vscode-resource' }).toString();
    }

    private initialHtml() {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>Infoview</title>
                <link rel="stylesheet" href="https://unpkg.com/tachyons/css/tachyons.min.css">
                <style>${this.stylesheet}</style>
            </head>
            <body>
                <div id="react_root"></div>
                <script src="${this.getMediaPath('index.js')}"></script>
            </body>
            </html>`
    }

    private async copyToComment(editor: TextEditor) {
        await editor.edit((builder) => {
            builder.insert(editor.selection.end.with({ character: 0 }).translate({ lineDelta: 1 }),
                '/-\n' + this.renderText() + '\n-/\n');
        });
    }
    private renderText(): string {
        const msgText = this.curMessages &&
            this.curMessages.map((m) =>
                `${basename(m.file_name)}:${m.pos_line}:${m.pos_col}: ${m.severity} ${m.caption}\n${m.text}`,
            ).join('\n');
        const goalText = this.curGoalState ? `Tactic State:\n${this.curGoalState}\n` : '';
        return goalText + msgText;
    }
}
