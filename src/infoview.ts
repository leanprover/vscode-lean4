import {Server} from './server';
import {TextDocumentContentProvider, Event, EventEmitter, Disposable, Uri, Range,
    CancellationToken, DocumentSelector, TextDocument, workspace, Position, window, commands, languages
} from 'vscode';
import { InfoRecord } from "lean-client-js-node";

class InfoDocument implements Disposable {
    private changedEmitter = new EventEmitter<any>();
    readonly onChanged = this.changedEmitter.event;
    
    private subscriptions: Disposable[] = [];

    private lines: string[];

    private paused: boolean = false;
    private showMessages: boolean = true;

    private fileName: string = null;
    private goalPosition: Position = null;

    private togglePauseCommand = 'lean.infoDocument.togglePause';
    private toggleMessagesCommand = 'lean.infoDocument.toggleMessages';

    constructor(private server: Server, private leanDocs: DocumentSelector) {
        this.render();
        this.subscriptions.push(
            this.server.allMessages.on(() => this.rerender()),
            this.server.statusChanged.on(() => this.updateGoal()),
            window.onDidChangeTextEditorSelection(() => this.updatePosition()),
            commands.registerCommand(this.togglePauseCommand, () => this.togglePause()),
            commands.registerCommand(this.toggleMessagesCommand, () => {
                this.showMessages = !this.showMessages;
                this.rerender();
            }),
        );
    }

    get text() {
        return this.lines.join('\n');
    }

    dispose() {
        for (const s of this.subscriptions) s.dispose();
    }

    private render() {
        this.lines = [];
        this.renderHeader();
        this.renderGoal();
        this.renderMessages();
    }

    private renderHeader() {
        const points: string[] = [];
        points.push(this.paused ? 'updates paused' : 'actively updating');
        points.push((this.showMessages ? 'showing' : 'hiding') + ' error messages');
        
        this.lines.push(' --' + points.map((p) => ` (${p})`).join(''), '');
    }

    private updatePosition() {
        if (!languages.match(this.leanDocs, window.activeTextEditor.document))
            return;

        const oldFile = this.fileName;
        const oldPos = this.goalPosition;

        this.fileName = window.activeTextEditor.document.fileName;
        this.goalPosition = window.activeTextEditor.selection.active;

        if (this.fileName !== oldFile) {
            this.curGoal = null;
            this.rerender();
        }
        if (!this.goalPosition.isEqual(oldPos)) {
            this.updateGoal();
        }
    }

    private curGoal: {
        file: string,
        line: number,
        column: number,
        state: string,
    };
    private updateGoal() {
        if (this.fileName && this.goalPosition) {
            const file = this.fileName;
            const line = this.goalPosition.line+1;
            const column = this.goalPosition.character;
            this.server.info(file, line, column).then((info) => {
                    if (info.record && info.record.state) {
                        this.curGoal = {
                            file, line, column,
                            state: info.record.state,
                        };
                        this.rerender();
                    }
                });
        } else {
            this.curGoal = null;
            this.rerender();
        }
    }

    private renderGoal() {
        if (!this.curGoal) return;
        const pos = this.goalPosition;
        const curGoal = this.curGoal;
        this.lines.push('-- goal' +
            (curGoal ? ` at ${curGoal.file}:${curGoal.line}:${curGoal.column}` : ''));
        [].push.apply(this.lines, curGoal.state.split('\n'));
        this.lines.push('');
    }

    private renderMessages() {
        if (!this.fileName || !this.showMessages) return;
        const msgs = this.server.messages
            .filter((m) => m.file_name === this.fileName)
            .sort((a, b) => a.pos_line === b.pos_line
                ? a.pos_col - b.pos_col
                : a.pos_line - b.pos_line);
        for (const m of msgs) {
            this.lines.push(`-- ${m.file_name}:${m.pos_line}:${m.pos_col}: ${m.severity} ${m.caption}`);
            [].push.apply(this.lines, m.text.split('\n'));
            this.lines.push('');
        }
    }

    private rerender() {
        if (this.paused) return;
        this.render();
        this.changedEmitter.fire();
    }

    private togglePause() {
        this.paused = !this.paused;
        this.render();
        this.changedEmitter.fire();
    }
}

export class InfoProvider implements TextDocumentContentProvider, Disposable {
    scheme = 'lean-info';

    documentSelector: DocumentSelector = {
        scheme: this.scheme,
    };

    private leanInfoPath = '.lean-info';
    leanInfoUrl = Uri.parse(`${this.scheme}:${this.leanInfoPath}`);

    private changedEmitter = new EventEmitter<Uri>();
    onDidChange = this.changedEmitter.event;
    private documents = new Map<string, InfoDocument>();
    private subscriptions: Disposable[] = [];

    constructor(private server: Server, private leanDocs: DocumentSelector) {
        this.subscriptions.push(workspace.onDidCloseTextDocument((doc) => {
            const uri = doc.uri.toString();
            if (this.documents.has(uri)) {
                this.documents.get(uri).dispose();
                this.documents.delete(uri);
            }
        }));
    }

    dispose() {
        this.documents.forEach((v) => v.dispose());
        for (const s of this.subscriptions) s.dispose();
    }

    provideTextDocumentContent(uri: Uri, token: CancellationToken): string {
        const uriString = uri.toString();
        if (!this.documents.has(uriString)) {
            if (this.leanInfoUrl.toString() !== uriString) {
                throw new Error(`unsupported uri: ${uri}`);
            }
            const doc = new InfoDocument(this.server, this.leanDocs);
            doc.onChanged(() => this.changedEmitter.fire(uri));
            this.documents.set(uriString, doc);
        }
        return this.documents.get(uriString).text;
    }
}