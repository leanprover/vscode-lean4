import { readFileSync } from 'fs';
import { Message } from 'lean-client-js-node';
import { basename, join } from 'path';
import {
    commands, Disposable, DocumentSelector,
    ExtensionContext, languages, Position, Range,
    Selection, TextEditor, TextEditorDecorationType, TextEditorRevealType,
    Uri, ViewColumn, WebviewPanel, window, workspace,
} from 'vscode';
import { Server } from './server';

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

enum DisplayMode {
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage, // all messages
}

export class InfoProvider implements Disposable {
    private webviewPanel: WebviewPanel;

    private subscriptions: Disposable[] = [];

    private displayMode: DisplayMode = DisplayMode.AllMessage;

    private started: boolean = false;
    private stopped: boolean = false;
    private curFileName: string = null;
    private curPosition: Position = null;
    private curGoalState: string = null;
    private curMessages: Message[] = null;

    private stylesheet: string = null;

    private hoverDecorationType: TextEditorDecorationType;

    constructor(private server: Server, private leanDocs: DocumentSelector, private context: ExtensionContext) {
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
            }),
            commands.registerCommand('_lean.revealPosition', this.revealEditorPosition),
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

    private updateStylesheet() {
        const css = this.context.asAbsolutePath(join('media', `infoview.css`));
        const fontFamily =
            (workspace.getConfiguration('editor').get('fontFamily') as string).
            replace(/['"]/g, '');
        this.stylesheet = readFileSync(css, 'utf-8') + `
            pre {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
                white-space: pre-wrap; // TODO(gabriel): make configurable
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
        let column = editor ? editor.viewColumn + 1 : ViewColumn.Three;
        if (column === 4) { column = ViewColumn.Three; }
        if (this.webviewPanel) {
            this.webviewPanel.reveal(column, true);
        } else {
            this.webviewPanel = window.createWebviewPanel('lean', 'Lean Messages',
                {viewColumn: column, preserveFocus: true},
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    enableCommandUris: true,
                });
            this.webviewPanel.webview.html = this.render();
            this.webviewPanel.onDidDispose(() => this.webviewPanel = null);
            this.webviewPanel.webview.onDidReceiveMessage((message) => {
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
                }
            }, undefined, this.subscriptions);
        }
    }

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

    private setMode(mode: DisplayMode) {
        if (this.displayMode === mode && !this.stopped) { return; }
        this.displayMode = mode;
        this.stopped = false;
        this.updatePosition(true);
    }

    private rerender() {
        if (this.webviewPanel) {
            this.webviewPanel.webview.html = this.render();
        }
    }
    private async postMessage(msg: any): Promise<boolean> {
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

        const chMsg = this.updateMessages();
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
        if (this.stopped) { return false; }

        const info = await this.server.info(
            this.curFileName, this.curPosition.line + 1, this.curPosition.character);
        if (info.record && info.record.state) {
            if (this.curGoalState !== info.record.state) {
                this.curGoalState = info.record.state;
                return true;
            }
        } else {
            if (this.curGoalState) {
                this.curGoalState = null;
                return false;
            }
        }
    }

    private getMediaPath(mediaFile: string): string {
        return Uri.file(this.context.asAbsolutePath(join('media', mediaFile)))
            .with({scheme: 'vscode-resource'}).toString();
    }

    private render() {
        const header = `<!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <style>${this.stylesheet}</style>
                <script charset="utf-8" src="${this.getMediaPath('infoview-ctrl.js')}"></script>
            </head>`;
        if (!this.curFileName) {
            return header + '<body>No Lean file active</body>';
        }
        return header +
            `<body
                data-uri="${encodeURI(Uri.file(this.curFileName).toString())}"
                data-line="${(this.curPosition.line + 1).toString()}"
                data-column="${this.curPosition.character.toString()}"
                ${this.displayMode === DisplayMode.AllMessage ? "data-messages=''" : ''}>
                <div id="debug"></div>
                ${this.curGoalState ? this.renderFilter() : ''}
                <div id="run-state">
                    <span id="state-continue">Stopped <a href="command:_lean.infoView.continue?{}">
                        <img title="Continue Updating" src="${this.getMediaPath('continue.svg')}"></a></span>
                    <span id="state-pause">Updating <a href="command:_lean.infoView.pause?{}">
                        <img title="Stop Updating" src="${this.getMediaPath('pause.svg')}"></span></a>
                </div>
                ${this.renderGoal()}
                <div id="messages">${this.renderMessages()}</div>
            </body></html>`;
    }

    private renderFilter() {
        const reFilters = workspace.getConfiguration('lean').get('infoViewTacticStateFilters', []);
        const filterIndex = workspace.getConfiguration('lean').get('infoViewFilterIndex', -1);
        return reFilters.length > 0 ?
            `<div id="filter">
            <select id="filterSelect" onchange="infoViewModule.selectFilter(this.value);">
                <option value="-1" ${filterIndex === -1 ? 'selected' : ''}>no filter</option>
                ${reFilters.map((obj, i) =>
                    `<option value="${i}" ${filterIndex === i ? 'selected' : ''}>
                    ${obj.name ||
                        `${obj.match ? 'show ' : 'hide '}/${obj.regex}/${obj.flags}`}</option>`)}
            </select>
        </div>` : '';
    }

    private colorizeMessage(goal: string): string {
        return escapeHtml(goal)
            .replace(/^([|⊢]) /mg, '<strong class="goal-vdash">$1</strong> ')
            .replace(/^(\d+ goals|1 goal)/mg, '<strong class="goal-goals">$1</strong>')
            .replace(/^(context|state):/mg, '<strong class="goal-goals">$1</strong>:')
            .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
            .replace(/^([^:\n< ][^:\n⊢]*) :/mg, '<strong class="goal-hyp">$1</strong> :');
    }

    private renderGoal() {
        if (!this.curGoalState || this.displayMode !== DisplayMode.OnlyState) { return ''; }
        const reFilters = workspace.getConfiguration('lean').get('infoViewTacticStateFilters', []);
        const filterIndex = workspace.getConfiguration('lean').get('infoViewFilterIndex', -1);
        let goalString: string = this.curGoalState.replace(/^(no goals)/mg, '0 goals\n proof completed');
        goalString = RegExp('^\\d+ goals', 'mg').test(goalString) ? goalString :
            '1 goal\n'.concat(goalString);
        const filteredGoalState = reFilters.length === 0 || filterIndex === -1 ? goalString :
            // this regex splits the goal state into (possibly multi-line) hypothesis and goal blocks
            // by keeping indented lines with the most recent non-indented line
            goalString.match(/(^(?!  ).*\n?(  .*\n?)*)/mg).map((line) => line.trim())
                .filter((line) => {
                    const filt = reFilters[filterIndex];
                    const test = line.match(new RegExp(filt.regex, filt.flags)) !== null;
                    return filt.match ? test : !test;
                }).join('\n');
        return `<div id="goal"><h1>Tactic State</h1><pre>${
            this.colorizeMessage(filteredGoalState)}</pre></div>`;
    }

    private renderMessages() {
        if (!this.curFileName || !this.curMessages) { return ``; }
        return this.curMessages.map((m) => {
            const f = escapeHtml(m.file_name); const b = escapeHtml(basename(m.file_name));
            const l = m.pos_line; const c = m.pos_col;
            const el = m.end_pos_line || l;
            const ec = m.end_pos_col || c;
            const cmd = encodeURI('command:_lean.revealPosition?' +
                JSON.stringify([Uri.file(m.file_name), m.pos_line, m.pos_col]));
            const shouldColorize = m.severity === 'error';
            const colorized = shouldColorize ? this.colorizeMessage(m.text) :
                escapeHtml(m.text);
            return `<div class="message ${m.severity}" data-line="${l}" data-column="${c}"
                data-end-line="${el}" data-end-column="${ec}">
                <h1 title="${f}:${l}:${c}"><a href="${cmd}">
                    ${b}:${l}:${c}: ${m.severity} ${escapeHtml(m.caption)}
                </a></h1>
                <pre>${colorized}</pre></div>`;
        }).join('\n');
    }

    private async copyToComment(editor: TextEditor) {
        await editor.edit((builder) => {
            builder.insert(editor.selection.end.with({character: 0}).translate({lineDelta: 1}),
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
