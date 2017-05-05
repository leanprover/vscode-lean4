import {Server} from './server';
import {TextDocumentContentProvider, EventEmitter, Disposable, Uri,
    CancellationToken, DocumentSelector, TextDocument, workspace} from 'vscode';

class ErrorViewDocument implements Disposable {
    private changedEmitter = new EventEmitter<any>();
    readonly onChanged = this.changedEmitter.event;
    
    private subscriptions: Disposable[] = [];

    lines: string[];

    constructor(private server: Server, public fileName: string) {
        this.render();
        this.subscriptions.push(this.server.allMessages.on(() => this.rerender()));
    }

    get text() {
        return this.lines.join('\n');
    }

    dispose() {
        for (const s of this.subscriptions) s.dispose();
    }

    private render() {
        const lines: string[] = [];

        const msgs = this.server.messages
            .filter((m) => m.file_name === this.fileName)
            .sort((a, b) => a.pos_line === b.pos_line
                ? a.pos_col - b.pos_col
                : a.pos_line - b.pos_line);
        for (const m of msgs) {
            lines.push(`-- ${m.file_name}:${m.pos_line}:${m.pos_col}: ${m.severity} ${m.caption}`);
            [].push.apply(lines, m.text.split('\n'));
            lines.push('');
        }

        this.lines = lines;
    }

    private rerender() {
        this.render();
        this.changedEmitter.fire();
    }
}

export class ErrorViewProvider implements TextDocumentContentProvider, Disposable {
    scheme = 'lean-errors';

    documentSelector: DocumentSelector = {
        scheme: this.scheme,
    };

    decodeUri(uri: Uri): string {
        if (uri.scheme !== this.scheme)
            throw new Error(`invalid scheme: ${uri}`);
        if (!uri.fsPath.endsWith('-errors'))
            throw new Error(`invalid extension: ${uri}`);
        return uri.fsPath.slice(0, uri.fsPath.length - '-errors'.length);
    }

    encodeUri(fileName: string): Uri {
        return Uri.parse(`${this.scheme}:${fileName}-errors`)
    }

    private changedEmitter = new EventEmitter<Uri>();
    onDidChange = this.changedEmitter.event;
    private documents = new Map<string, ErrorViewDocument>();
    private subscriptions: Disposable[] = [];

    constructor(private server: Server) {
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
            const fileName = this.decodeUri(uri);
            const doc = new ErrorViewDocument(this.server, fileName);
            doc.onChanged(() => this.changedEmitter.fire(uri));
            this.documents.set(uriString, doc);
        }
        return this.documents.get(uriString).text;
    }
}