import { Disposable, ExtensionContext, OverviewRulerLane, Range, TextEditorDecorationType, window } from 'vscode';
import { LeanClient } from './leanclient';

class LeanFileTaskGutter {
    private timeout: NodeJS.Timeout

    constructor(private uri: string, private decoration: TextEditorDecorationType, private processed: number | undefined) {
        this.schedule(100)
    }

    setProcessed(processed: number | undefined) {
        if (processed === this.processed) return;
        const oldProcessed = this.processed;
        this.processed = processed;
        if (processed === undefined) {
            this.clearTimeout();
            this.updateDecos();
        } else if (this.timeout === undefined) {
            this.schedule(oldProcessed === undefined ? 500 : 20)
        }
    }

    private schedule(ms: number) {
        this.timeout = setTimeout(() => {
            this.timeout = undefined
            this.updateDecos()
        }, ms)
    }

    private clearTimeout() {
        if (this.timeout !== undefined) {
            clearTimeout(this.timeout)
            this.timeout = undefined;
        }
    }

    private updateDecos() {
        for (const editor of window.visibleTextEditors) {
            if (editor.document.uri.toString() === this.uri) {
                editor.setDecorations(this.decoration, this.processed === undefined ? [] : [{
                    range: new Range(this.processed, 0, editor.document.lineCount, 0),
                    hoverMessage: 'busily processing...',
                }]);
            }
        }
    }

    dispose() {
        this.clearTimeout();
    }
}

export class LeanTaskGutter implements Disposable {
    private decoration: TextEditorDecorationType;
    private status: { [uri: string]: number | undefined } = {};
    private gutters: { [uri: string]: LeanFileTaskGutter } = {};
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

        this.subscriptions.push(
            window.onDidChangeVisibleTextEditors(() => this.updateDecos()),
            client.progressChanged((progress) => {
                for (const [uri, processing] of progress) {
                    this.status[uri.toString()] = processing.length === 0 ? undefined :
                        Math.min(...processing.map(p => p.range.start.line));
                }
                this.updateDecos()
            }));
    }

    private updateDecos() {
        const uris: { [uri: string]: boolean } = {}
        for (const editor of window.visibleTextEditors) {
            if (editor.document.languageId !== 'lean4' && editor.document.languageId !== 'lean') continue;
            const uri = editor.document.uri.toString();
            uris[uri] = true
            const processed = uri in this.status ? this.status[uri] : 0
            if (this.gutters[uri]) {
                this.gutters[uri].setProcessed(processed)
            } else {
                this.gutters[uri] = new LeanFileTaskGutter(uri, this.decoration, processed)
            }
        }
        for (const uri of Object.getOwnPropertyNames(this.gutters)) {
            if (!uris[uri]) {
                this.gutters[uri].dispose();
                this.gutters[uri] = undefined;
            }
        }
    }

    dispose(): void {
        this.decoration.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
