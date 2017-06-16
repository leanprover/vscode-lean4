import { basename, join } from 'path';
import { readFileSync } from 'fs';
import {
    TextDocumentContentProvider, Event, EventEmitter, Disposable, Uri, Range, ExtensionContext,
    CancellationToken, DocumentSelector, TextDocument, TextEditorRevealType, Position, Selection,
    TextEditorDecorationType, workspace, window, commands, languages
} from 'vscode';
import { InfoRecord, Message } from "lean-client-js-node";
import { Server } from './server';

function compareMessages(m1: Message, m2: Message): boolean {
    return (m1.file_name == m2.file_name &&
        m1.pos_line == m2.pos_line && m1.pos_col == m2.pos_col &&
        m1.severity == m2.severity && m1.caption == m2.caption && m1.text == m2.text);
}

// https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

enum DisplayMode {
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage // all messages 
}

export class InfoProvider implements TextDocumentContentProvider, Disposable {
    leanGoalsUri = Uri.parse('lean-info:goals');

    private changedEmitter = new EventEmitter<Uri>();
    onDidChange = this.changedEmitter.event;

    private subscriptions: Disposable[] = [];

    private displayMode: DisplayMode = DisplayMode.AllMessage;

    private stopped: boolean = false;
    private curFileName: string = null;
    private curPosition: Position = null;
    private curGoalState: string = null;
    private curMessages: Message[] = null;

    private stylesheet: string = null;

    private hoverDecorationType : TextEditorDecorationType;

    constructor(private server: Server, private leanDocs: DocumentSelector, private context: ExtensionContext) {
        this.hoverDecorationType = window.createTextEditorDecorationType({
            backgroundColor: 'red', // make configurable?
            border: '3px solid red'
        });

        this.subscriptions.push(
            this.server.allMessages.on(() => {
                if (this.updateMessages()) this.fire();
            }),
            this.server.statusChanged.on(() => {
                this.updateGoal().then((changed) => { if (changed && this.displayGoal()) this.fire(); })
            }),
            window.onDidChangeTextEditorSelection(() => this.updatePosition()),
            commands.registerCommand('_lean.revealPosition', this.revealEditorPosition),
            commands.registerCommand('_lean.hoverPosition', (u, l, c) => { this.hoverEditorPosition(u, l, c); }),
            commands.registerCommand('_lean.stopHover', () => { this.stopHover() }),
            commands.registerCommand('lean.infoView.toggleMode', (editor) => { 
                this.toggleMode();
            }),
            commands.registerCommand('lean.infoView.startStop', (editor) => { 
                this.startStop();
            })
        );
        let css = this.context.asAbsolutePath(join('media', `infoview.css`));
        let js = this.context.asAbsolutePath(join('media', `infoview-ctrl.js`));
        // TODO: update stylesheet on configuration changes
        this.stylesheet = readFileSync(css, "utf-8") + `
            pre {
                font-family: ${workspace.getConfiguration('editor').get('fontFamily')};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
            }
            ` +
            workspace.getConfiguration('lean').get('infoViewStyle');
        this.updatePosition();
    }

    dispose() {
        for (const s of this.subscriptions) s.dispose();
    }

    provideTextDocumentContent(uri: Uri, token: CancellationToken): string {
        if (uri.toString() == this.leanGoalsUri.toString()) {
            const content = this.render();
            return content;
        } else
            throw new Error(`unsupported uri: ${uri}`);
    }

    private displayGoal() : boolean {
        return this.displayMode == DisplayMode.OnlyState;
    }

    private displayPosition() : boolean {
        return this.displayMode == DisplayMode.AllMessage;
    }

    private sendPosition() {
        commands.executeCommand('_workbench.htmlPreview.postMessage', this.leanGoalsUri,
            {
                command: 'position',
                fileName: this.curFileName,
                line: this.curPosition.line + 1,
                column: this.curPosition.character
            });
    }

    private startStop() {
        this.stopped = !this.stopped;
        if (!this.stopped) {
            this.update();
        }
    }

    private update() {
        switch(this.displayMode) {
        case DisplayMode.AllMessage:
            this.updateMessages();
            this.fire();
            break;
        case DisplayMode.OnlyState:
            this.updateMessages();
            this.updateGoal().then((changed) => { this.fire() });
            break;
        }
    }

    private toggleMode() {
        switch(this.displayMode) {
        case DisplayMode.AllMessage:
            this.displayMode = DisplayMode.OnlyState;
            break;
        case DisplayMode.OnlyState:
            this.displayMode = DisplayMode.AllMessage;
            break;
        }
        this.update();
    }

    private fire() {
        this.changedEmitter.fire(this.leanGoalsUri);
    }

    private revealEditorPosition(uri: Uri, line: number, column: number) {
        for (let editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) {
                let pos = new Position(line - 1, column);
                window.showTextDocument(editor.document);
                editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenterIfOutsideViewport);
                editor.selection = new Selection(pos, pos);
            }
        }
    }

    private hoverEditorPosition(uri: string, line: number, column: number) {
        for (let editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri) {
                let pos = new Position(line - 1, column);
                let range = new Range(pos, pos.translate(0, 1));
                editor.setDecorations(this.hoverDecorationType, [range]);
            }
        }
    }

    private stopHover() {
        for (let editor of window.visibleTextEditors) {
            if (editor.document.languageId === 'lean') {
                editor.setDecorations(this.hoverDecorationType, []);
            }
        }
    }

    private updatePosition() {
        if (this.stopped || !languages.match(this.leanDocs, window.activeTextEditor.document))
            return;

        const oldFileName = this.curFileName;
        const oldPosition = this.curPosition;

        this.curFileName = window.activeTextEditor.document.fileName;
        this.curPosition = window.activeTextEditor.selection.active;

        const f = this.curFileName;
        const l = this.curPosition.line + 1;
        const c = this.curPosition.character;
        if (this.curFileName !== oldFileName || !this.curPosition.isEqual(oldPosition)) {
            const chMsg = this.updateMessages();
            switch (this.displayMode) {
            case DisplayMode.OnlyState:
                this.updateGoal().then((chGoal) => { if (chGoal || chMsg) this.fire() });
                break;

            case DisplayMode.AllMessage:
                if (chMsg) {
                    this.fire();
                } else {
                    this.sendPosition()
                }
                break;
            }
        }
    }

    private updateMessages(): boolean {
        if (this.stopped || !this.curFileName) return false;
        let msgs : Message[];
        switch (this.displayMode) {
        case DisplayMode.OnlyState:
            /* Heuristic: find first position to the left which has messages attached,
               from that on show all messages in this line */
            msgs = this.server.messages
                .filter((m) => m.file_name === this.curFileName &&
                    m.pos_line == this.curPosition.line + 1)
                .sort((a, b) => a.pos_col - b.pos_col);
            let startColumn = undefined;
            let startPos = null;
            for (let i = 0; i < msgs.length; i++) {
                if (this.curPosition.character < msgs[i].pos_col) break;
                if (this.curPosition.character == msgs[i].pos_col) {
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
        const old_msgs = this.curMessages;
        if (msgs.length == old_msgs.length) {
            let eq = true;
            for (let i = 0; i < msgs.length; i++) {
                if (!compareMessages(msgs[i], old_msgs[i])) {
                    eq = false;
                    break;
                }
            }
            if (eq) return false;
        }
        this.curMessages = msgs;
        return true;
    }

    private updateGoal(): Promise<boolean> {
        if (this.stopped) return Promise.resolve(false);

        const f = this.curFileName;
        const l = this.curPosition.line + 1;
        const c = this.curPosition.character;

        return this.server.info(f, l, c).then((info) => {
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
        });
    }

    private getMediaPath(mediaFile: string): string {
        return Uri.file(this.context.asAbsolutePath(join('media', mediaFile))).toString();
    }

    private render() {
        return `<!DOCTYPE html>
            <html>
            <head> 
              <meta http-equiv="Content-type" content="text/html;charset=utf-8">
              <style>${escapeHtml(this.stylesheet)}</style>
              <script charset="utf-8" src="${this.getMediaPath("infoview-ctrl.js")}"></script>
            </head>
            <body
                data-uri="${encodeURI(Uri.file(this.curFileName).toString())}"
                data-line="${(this.curPosition.line + 1).toString()}"
                data-column="${this.curPosition.character.toString()}"
                ${this.displayMode == DisplayMode.AllMessage ? "data-messages=''" : ""}">
              <div id="debug"></div>
              ${this.renderGoal()}
              <div id="messages">${this.renderMessages()}</div>
            </body></html>`;
    }

    private renderGoal() {
        if (!this.curGoalState || this.displayMode !== DisplayMode.OnlyState) return '';
        return `<div id="goal"><h1>Tactic State</h1><pre>${escapeHtml(this.curGoalState)}</pre></div>`;
    }

    private renderMessages() {
        if (!this.curFileName) return ``;
        return this.curMessages.map((m) => {
            const f = escapeHtml(m.file_name); const b = escapeHtml(basename(m.file_name));
            const l = m.pos_line.toString(); const c = m.pos_col.toString();
            const cmd = encodeURI('command:_lean.revealPosition?' +
                JSON.stringify([Uri.file(m.file_name), m.pos_line, m.pos_col]));
            return `<div class="message ${m.severity}" data-line="${l}" data-column="${c}">
                <h1 title="${f}:${l}:${c}"><a href="${cmd}">
                    ${b}:${l}:${c}: ${m.severity} ${escapeHtml(m.caption)}
                </a></h1>
                <pre>${escapeHtml(m.text)}</pre></div>`
        }).join("\n");
    }
}