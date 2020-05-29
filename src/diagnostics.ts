import { Message, Severity } from 'lean-client-js-node';
import { Diagnostic, DiagnosticCollection, DiagnosticSeverity,
    Disposable, languages, Position, Range, TextDocument, Uri, workspace } from 'vscode';
import { Server } from './server';

function toSeverity(severity: Severity): DiagnosticSeverity {
    switch (severity) {
        case 'warning': return DiagnosticSeverity.Warning;
        case 'error': return DiagnosticSeverity.Error;
        case 'information': return DiagnosticSeverity.Information;
        default: return DiagnosticSeverity.Error;
    }
}

export class LeanDiagnosticsProvider implements Disposable {
    collection: DiagnosticCollection;
    private subscriptions: Disposable[] = [];

    constructor(server: Server) {
        this.collection = languages.createDiagnosticCollection('lean');
        this.subscriptions.push(this.collection);

        this.subscriptions.push(
            server.allMessages.on((msgs) => this.updateDiagnostics(msgs.msgs)));

        this.subscriptions.push(server.restarted.on(() => this.updateDiagnostics([])));
    }

    private updateDiagnostics(messages: Message[]) {
        const diagnosticMap = new Map<string, Diagnostic[]>();
        const docMap = new Map<string, TextDocument>();

        for (const message of messages) {
            const line = Math.max(message.pos_line - 1, 0);
            const pos = new Position(line, message.pos_col);
            // Assign the diagnostic to the entire word following the info message
            // so that code actions can be activated more easily
            let msgDoc = docMap.get(message.file_name);
            if (!msgDoc) {
                msgDoc = workspace.textDocuments.find((doc) => doc.fileName === message.file_name);
                docMap.set(message.file_name, msgDoc);
            }
            const range = msgDoc.getWordRangeAtPosition(pos) || new Range(pos, pos);
            let diagnostics = diagnosticMap.get(message.file_name);
            if (!diagnostics) { diagnosticMap.set(message.file_name, diagnostics = []); }
            const d = new Diagnostic(range, message.text,
                toSeverity(message.severity));
            d.source = 'Lean';
            diagnostics.push(d);
        }

        const fileNameToUri = new Map<string, Uri>();
        for (const doc of workspace.textDocuments) {
            fileNameToUri.set(doc.fileName, doc.uri);
        }

        this.collection.clear();
        diagnosticMap.forEach((diags, file) =>
            this.collection.set(fileNameToUri.get(file), diags));
    }

    dispose() {
        for (const s of this.subscriptions) { s.dispose(); }
     }
}
