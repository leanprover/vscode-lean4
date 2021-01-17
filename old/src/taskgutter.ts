import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, Disposable, ExtensionContext,
    languages, OverviewRulerLane, Range, TextEditorDecorationType, Uri, window, workspace } from 'vscode';
import { Server } from './server';
import { ServerStatus } from './shared';

export class LeanTaskGutter implements Disposable {
    private decoration: TextEditorDecorationType;
    private subscriptions: Disposable[] = [];

    constructor(server: Server, context: ExtensionContext) {
        this.decoration = window.createTextEditorDecorationType({
            overviewRulerLane: OverviewRulerLane.Left,
            overviewRulerColor: 'rgba(255, 165, 0, 0.5)',
            dark: {
                gutterIconPath: context.asAbsolutePath('media/progress-dark.svg'),
            },
            light: {
                gutterIconPath: context.asAbsolutePath('media/progress-light.svg'),
            },
            gutterIconSize: 'contain',
        });

        this.subscriptions.push(server.statusChanged.on(
            (status) => this.updateDecos(status)));
    }

    private updateDecos(status: ServerStatus) {
        for (const editor of window.visibleTextEditors) {
            editor.setDecorations(this.decoration,
                status.tasks.filter((t) => t.file_name === editor.document.fileName)
                    .map((task) => ({
                        range: new Range(
                            task.pos_line - 1, task.pos_col,
                            task.end_pos_line - 1, task.end_pos_col,
                        ),
                        hoverMessage: task.desc,
                    })));
        }
    }

    dispose(): void {
        this.decoration.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }
}

export class LeanTaskMessages implements Disposable {
    private collection: DiagnosticCollection;
    private subscriptions: Disposable[] = [];

    constructor(server: Server) {
        this.collection = languages.createDiagnosticCollection('lean-tasks');
        this.subscriptions.push(server.statusChanged.on(
            (status) => this.updateMsgs(status)));
        this.subscriptions.push(workspace.onDidChangeConfiguration(() =>
            this.updateMsgs(server.statusChanged.currentValue)));
    }

    private updateMsgs(status: ServerStatus) {
        const diagsPerFile = new Map<string, Diagnostic[]>();

        if (workspace.getConfiguration('lean').get('progressMessages')) {
            for (const task of status.tasks) {
                let diags = diagsPerFile.get(task.file_name);
                if (!diags) { diagsPerFile.set(task.file_name, diags = []); }
                diags.push(new Diagnostic(
                    new Range(task.pos_line - 1, task.pos_col,
                        task.end_pos_line - 1, task.end_pos_col),
                    task.desc, DiagnosticSeverity.Information,
                ));
            }
        }

        this.collection.clear();
        diagsPerFile.forEach((diags, file) => this.collection.set(Uri.file(file), diags));
    }

    dispose(): void {
        this.collection.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
