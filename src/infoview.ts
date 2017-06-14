import { basename, join } from 'path';
import {
    TextDocumentContentProvider, Event, EventEmitter, Disposable, Uri, Range, ExtensionContext,
    CancellationToken, DocumentSelector, TextDocument, TextEditorRevealType, Position, Selection,
    workspace, window, commands, languages
} from 'vscode';
import { Server } from './server';
import { InfoRecord, Message } from "lean-client-js-node";

function compareMessages(m1: Message, m2: Message) : boolean {
    return (m1.file_name == m2.file_name &&
        m1.pos_line == m2.pos_line && m1.pos_col == m2.pos_col &&
        m1.severity == m2.severity && m1.caption == m2.caption && m1.text == m2.text);
}

export class InfoProvider implements TextDocumentContentProvider, Disposable {
    leanGoalsUri = Uri.parse('lean-info:goals');

    private changedEmitter = new EventEmitter<Uri>();
    onDidChange = this.changedEmitter.event;

    private subscriptions: Disposable[] = [];

    private curFileName  : string = null;
    private curPosition  : Position = null;
    private curGoalState : string = null;
    private curMessages  : Message[] = null;

    constructor(private server: Server, private leanDocs: DocumentSelector, private context : ExtensionContext) {
        this.subscriptions.push(
            this.server.allMessages.on(() => this.updateMessages()),
            this.server.statusChanged.on(() => this.updateGoal()),
            window.onDidChangeTextEditorSelection(() => this.updatePosition())
        );
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

    private fire() {
        this.changedEmitter.fire(this.leanGoalsUri);
    }

    private revealEditorPosition(uri: Uri, line: number, column: number) {
        for (let editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === uri.toString()) {
                let pos = new Position(line, column);
                window.showTextDocument(editor.document);
                editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenterIfOutsideViewport);
                editor.selection = new Selection(pos, pos);
            }
        }
    }

    private updatePosition() {
        if (!languages.match(this.leanDocs, window.activeTextEditor.document))
            return;

        const oldFileName = this.curFileName;
        const oldPosition = this.curPosition;

        this.curFileName = window.activeTextEditor.document.fileName;
        this.curPosition = window.activeTextEditor.selection.active;

        const f = this.curFileName;
        const l = this.curPosition.line + 1;
        const c = this.curPosition.character;
        if (this.curFileName !== oldFileName || !this.curPosition.isEqual(oldPosition)) {
            this.updateMessages();
            this.updateGoal();
            this.fire();
        }
    }

    private updateMessages() {
        if (!this.curFileName) return;
        const msgs = this.server.messages
            .filter((m) => m.file_name === this.curFileName &&
                m.pos_line == this.curPosition.line + 1 &&
                m.pos_col == this.curPosition.character);
        if (!this.curMessages) {
            this.curMessages = msgs;
            this.fire();
            return;
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
            if (eq) return;
        }
        this.curMessages = msgs;
    }

    private updateGoal() {
        const f = this.curFileName;
        const l = this.curPosition.line + 1;
        const c = this.curPosition.character;
        this.server.info(f, l, c).then((info) => {
            if (info.record && info.record.state) {
                if (this.curGoalState !== info.record.state) {
                    this.curGoalState = info.record.state;
                    this.fire();
                }
            } else {
                if (this.curGoalState) {
                    this.curGoalState = null;
                    this.fire();
                }
            }
        })

    }

	private getMediaPath(mediaFile: string): string {
		return Uri.file(this.context.asAbsolutePath(join('media', mediaFile))).toString();
	}

    private render() {
        return `<!DOCTYPE html>
            <html>
            <head> 
            <meta http-equiv="Content-type" content="text/html;charset=UTF-8">
            <style>
            div
{
  display: block;
  width: 100%;
  margin: 0px;
  padding: 0px;
}

h1
{
  display: block;
  width: 100%;

  margin-bottom: 1ex;
  margin-top: 1ex;
  border-bottom: 1px solid black;
  padding: 0px;

  font-weight: normal;
  font-size: 100%;
}

div.error h1 {
  color: red;
}

div.warning h1 {
  color: darkorange;
}

div.information h1 {
  color: darkgreen;
}

#messages div {
  border-top: 5px solid transparent;
}

.vscode-light h1 {
  border-bottom: 1px solid black;
}

.vscode-dark h1 {
  border-bottom: 1px solid white;
}

.vscode-dark div.highlight {
  background: darkolivegreen;
}

            </style>
            </head>
            <body>` +
                this.renderGoal() +
                `<div id="messages">` + this.renderMessages() + `</div>`+
            `</body></html>`;
    }

    private renderGoal() {
        const goalState = this.curGoalState;
        if (!goalState) return '';
        return `<div id="goal"><h1>Tactic State</h1><pre>${goalState}</pre></div>`;
    }

    private renderMessages() {
        if (!this.curFileName) return ``;
        return this.curMessages.map((m) => {
            const i = m.text.indexOf("\n");
            if (i == -1) {
                return `<div class="message ${m.severity}"><h1>${m.severity}: ${m.caption}</h1><pre>${m.text}</pre></div>`
            }
            return `<div class="message ${m.severity}">
                <h1>${m.severity}: ${m.caption} ${m.text.substring(0, i)}</h1>
                <pre>${m.text.substring(i)}</pre>
            </div>`}).join("\n");
    }
}