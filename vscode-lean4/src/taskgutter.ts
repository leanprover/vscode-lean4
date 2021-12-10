import { Disposable, ExtensionContext, OverviewRulerLane, Range, TextEditorDecorationType, window } from 'vscode';
import { LeanClient } from './leanclient';
import { LeanFileProgressKind } from '@lean4/infoview';

class LeanFileTaskGutter {
    private timeout?: NodeJS.Timeout

    constructor(private uri: string, private decorations: Map<LeanFileProgressKind, [TextEditorDecorationType, string]>, private processed: Map<LeanFileProgressKind, number> | undefined) {
        this.schedule(100)
    }

    setProcessed(processed: Map<LeanFileProgressKind, number> | undefined) {
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
                    for (const [decoration, _message] of this.decorations.values()) {
                        editor.setDecorations(decoration, [])
                    }
                } else {
                    for (const [kind, [decoration, message]] of this.decorations) {
                        if (this.processed.has(kind)) {
                            const line = this.processed.get(kind)

                            editor.setDecorations(decoration, [{
                                range: new Range(line, 0, editor.document.lineCount, 0),
                                hoverMessage: message
                            }])
                        } else {
                            editor.setDecorations(decoration, [])
                        }
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
    private decorations: Map<LeanFileProgressKind, [TextEditorDecorationType, string]> = new Map<LeanFileProgressKind, [TextEditorDecorationType, string]>();
    private status: { [uri: string]: Map<LeanFileProgressKind, number> | undefined } = {};
    private gutters: { [uri: string]: LeanFileTaskGutter | undefined } = {};
    private subscriptions: Disposable[] = [];

    constructor(client: LeanClient, context: ExtensionContext) {
        this.decorations.set(LeanFileProgressKind.Processing, [
            window.createTextEditorDecorationType({
                overviewRulerLane: OverviewRulerLane.Left,
                overviewRulerColor: 'rgba(255, 165, 0, 0.5)',
                dark: {
                    gutterIconPath: context.asAbsolutePath('media/progress-dark.svg'),
                },
                light: {
                    gutterIconPath: context.asAbsolutePath('media/progress-light.svg'),
                },
                gutterIconSize: 'contain',
            }),
            'busily processing...'
        ])
        this.decorations.set(LeanFileProgressKind.FatalError, [
            window.createTextEditorDecorationType({
                overviewRulerLane: OverviewRulerLane.Left,
                overviewRulerColor: 'rgba(255, 0, 0, 0.5)',
                dark: {
                    gutterIconPath: context.asAbsolutePath('media/progress-error-dark.svg'),
                },
                light: {
                    gutterIconPath: context.asAbsolutePath('media/progress-error-light.svg'),
                },
                gutterIconSize: 'contain',
            }),
            'processing stopped'
        ])

        this.subscriptions.push(
            window.onDidChangeVisibleTextEditors(() => this.updateDecos()),
            client.progressChanged((progress) => {
                for (const [uri, processing] of progress) {
                    if (processing.length === 0) {
                        this.status[uri.toString()] = undefined
                    } else {
                        const newStatus = new Map<LeanFileProgressKind, number>()
                        for (const kind of this.decorations.keys()) {
                            const kindProcessing = processing.filter(p => (p.kind === undefined ? LeanFileProgressKind.Processing : p.kind) === kind)
                            if (kindProcessing.length > 0) {
                                newStatus.set(kind, Math.min(...kindProcessing.map(p => p.range.start.line)))
                            }
                        }
                        this.status[uri.toString()] = newStatus
                    }
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
                this.gutters[uri] = new LeanFileTaskGutter(uri, this.decorations, processed)
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
        for (const [decoration, _message] of this.decorations.values()) { decoration.dispose() }
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
