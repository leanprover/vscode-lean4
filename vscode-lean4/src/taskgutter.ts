import { Disposable, ExtensionContext, OverviewRulerLane, Range, TextEditorDecorationType, window } from 'vscode';
import { LeanClient } from './leanclient';

class LeanFileTaskGutter {
    private timeout?: NodeJS.Timeout

    constructor(private uri: string, private decoration: TextEditorDecorationType, private decorationError: TextEditorDecorationType, private processed: [number, boolean] | undefined) {
        this.schedule(100)
    }

    setProcessed(processed: [number, boolean] | undefined) {
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
                if (this.processed === undefined) {
                    editor.setDecorations(this.decoration, []);
                    editor.setDecorations(this.decorationError, []);
                } else {
                    const [line, error] = this.processed
                    if (error) {
                        editor.setDecorations(this.decoration, []);
                        editor.setDecorations(this.decorationError, [{
                            range: new Range(line, 0, editor.document.lineCount, 0),
                            hoverMessage: 'processing stopped',
                        }]);
                    } else {
                        editor.setDecorations(this.decorationError, []);
                        editor.setDecorations(this.decoration, [{
                            range: new Range(line, 0, editor.document.lineCount, 0),
                            hoverMessage: 'busily processing...',
                        }]);
                    }
                }
            }
        }
    }

    dispose() {
        this.clearTimeout();
    }
}

export class LeanTaskGutter implements Disposable {
    private decoration: TextEditorDecorationType;
    private decorationError: TextEditorDecorationType;
    private status: { [uri: string]: [number, boolean] | undefined } = {};
    private gutters: { [uri: string]: LeanFileTaskGutter | undefined } = {};
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
        this.decorationError = window.createTextEditorDecorationType({
            overviewRulerLane: OverviewRulerLane.Left,
            overviewRulerColor: 'rgba(255, 0, 0, 0.5)',
            dark: {
                gutterIconPath: context.asAbsolutePath('media/progress-error-dark.svg'),
            },
            light: {
                gutterIconPath: context.asAbsolutePath('media/progress-error-light.svg'),
            },
            gutterIconSize: 'contain',
        });

        this.subscriptions.push(
            window.onDidChangeVisibleTextEditors(() => this.updateDecos()),
            client.progressChanged((progress) => {
                for (const [uri, processing] of progress) {
                    this.status[uri.toString()] = processing.length === 0 ? undefined : [
                        Math.min(...processing.map(p => p.range.start.line)),
                        processing.some((process) => process.error)
                    ];
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
            const processed = uri in this.status ? this.status[uri] : undefined
            if (this.gutters[uri]) {
                this.gutters[uri].setProcessed(processed)
            } else {
                this.gutters[uri] = new LeanFileTaskGutter(uri, this.decoration, this.decorationError, processed)
            }
        }
        for (const uri of Object.getOwnPropertyNames(this.gutters)) {
            if (!uris[uri]) {
                this.gutters[uri]?.dispose();
                this.gutters[uri] = undefined;
            }
        }
    }

    dispose(): void {
        this.decoration.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
