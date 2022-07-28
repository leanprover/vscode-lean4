import { Disposable, ExtensionContext, OverviewRulerLane, Range, TextEditorDecorationType, window } from 'vscode';
import { LeanFileProgressKind, LeanFileProgressProcessingInfo } from '@leanprover/infoview-api';
import { LeanClientProvider } from './utils/clientProvider';

class LeanFileTaskGutter {
    private timeout?: NodeJS.Timeout

    constructor(private uri: string, private decorations: Map<LeanFileProgressKind, [TextEditorDecorationType, string]>, private processed: LeanFileProgressProcessingInfo[]) {
        this.schedule(100)
        this.processed = []
    }

    setProcessed(processed: LeanFileProgressProcessingInfo[]) {
        if (processed === this.processed) return;
        const oldProcessed = this.processed;
        this.processed = processed;
        if (processed === undefined) {
            this.processed = []
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
                for (const [kind, [decoration, message]] of this.decorations) {
                    editor.setDecorations(
                        decoration,
                        this.processed
                            .filter(info => (info.kind === undefined ? LeanFileProgressKind.Processing : info.kind) === kind)
                            .map(info => ({
                                range: new Range(info.range.start.line, 0, info.range.end.line, 0),
                                hoverMessage: message
                            }))
                    )
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
    private status: { [uri: string]: LeanFileProgressProcessingInfo[] } = {};
    private gutters: { [uri: string]: LeanFileTaskGutter | undefined } = {};
    private subscriptions: Disposable[] = [];

    constructor(client: LeanClientProvider, context: ExtensionContext) {
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
            client.progressChanged(([uri, processing]) => {
                this.status[uri.toString()] = processing
                this.updateDecos()
            }));
    }

    private updateDecos() {
        const uris: { [uri: string]: boolean } = {}
        for (const editor of window.visibleTextEditors) {
            if (editor.document.languageId !== 'lean4' && editor.document.languageId !== 'lean') continue;
            const uri = editor.document.uri.toString();
            uris[uri] = true
            const processed = uri in this.status ? this.status[uri] : []
            if (this.gutters[uri]) {
                const gutter = this.gutters[uri];
                if (gutter) gutter.setProcessed(processed)
            } else {
                this.gutters[uri] = new LeanFileTaskGutter(uri, this.decorations, processed)
            }
        }
        for (const uri of Object.getOwnPropertyNames(this.gutters)) {
            if (!uris[uri]) {
                this.gutters[uri]?.dispose();
                this.gutters[uri] = undefined;
                // TODO: also clear this.status for this uri ?
            }
        }
    }

    dispose(): void {
        for (const [decoration, _message] of this.decorations.values()) { decoration.dispose() }
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
