import { Diagnostic, DiagnosticCollection, DiagnosticSeverity, Disposable, ExtensionContext,
    languages, OverviewRulerLane, Range, TextEditorDecorationType, Uri, window, workspace } from 'vscode';
import { LeanClient } from './leanclient';
import { ServerProgress } from './leanclientTypes';

export class LeanTaskGutter implements Disposable {
    private decoration: TextEditorDecorationType;
    private subscriptions: Disposable[] = [];

    constructor(client: LeanClient, context: ExtensionContext) {
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

        this.subscriptions.push(client.progressChanged(
            (status) => this.updateDecos(status)));
    }

    private updateDecos(status: ServerProgress) {
        for (const editor of window.visibleTextEditors) {
            const line = status[editor.document.uri.toString()];
            editor.setDecorations(this.decoration, line === undefined ? [] : [{
                range: new Range(line, 0, editor.document.lineCount, 0),
                hoverMessage: 'busily processing...',
            }]);
        }
    }

    dispose(): void {
        this.decoration.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
