import {
    AbbreviationConfig,
    AbbreviationProvider,
    AbbreviationRewriter,
    AbbreviationTextSource,
    Change,
    Range,
    SelectionMoveMode,
} from '@leanprover/unicode-input'
import {
    Disposable,
    Range as LineColRange,
    OutputChannel,
    Selection,
    TextDocument,
    TextEditor,
    commands,
    extensions,
    window,
    workspace,
} from 'vscode'

/**
 * Tracks abbreviations in a given text editor and replaces them when dynamically.
 */
export class VSCodeAbbreviationRewriter implements AbbreviationTextSource {
    private readonly disposables = new Array<Disposable>()
    private readonly rewriter

    private readonly decorationType = window.createTextEditorDecorationType({
        textDecoration: 'underline',
    })

    private firstOutput = true
    private isVimExtensionInstalled = false

    private checkIsVimExtensionInstalled() {
        this.isVimExtensionInstalled = extensions.getExtension('vscodevim.vim') !== undefined
    }

    constructor(
        readonly config: AbbreviationConfig,
        readonly abbreviationProvider: AbbreviationProvider,
        private readonly outputChannel: OutputChannel,
        private readonly textEditor: TextEditor,
        private selectionMoveMoveOverride?: SelectionMoveMode
    ) {
        this.rewriter = new AbbreviationRewriter(config, abbreviationProvider, this)

        this.disposables.push(this.decorationType)

        this.disposables.push(
            workspace.onDidChangeTextDocument(async e => {
                if (e.document !== this.textEditor.document) {
                    return
                }

                const changes: Change[] = e.contentChanges.map(changeEvent => ({
                    range: new Range(changeEvent.rangeOffset, changeEvent.rangeLength),
                    newText: changeEvent.text,
                }))
                this.rewriter.changeInput(changes)
                await this.rewriter.triggerAbbreviationReplacement()

                this.updateState()
            }),
        )
        this.disposables.push(
            window.onDidChangeTextEditorSelection(async e => {
                if (e.textEditor.document !== this.textEditor.document) {
                    return
                }

                const selections = e.selections.map(s => fromVsCodeRange(s, e.textEditor.document))
                await this.rewriter.changeSelections(selections)
                this.updateState()
            }),
        )

        this.checkIsVimExtensionInstalled()
        this.disposables.push(extensions.onDidChange(_ => this.checkIsVimExtensionInstalled()))
    }

    private writeError(e: string) {
        this.outputChannel.appendLine(e)
        if (this.firstOutput) {
            this.outputChannel.show(true)
            this.firstOutput = false
        }
    }

    selectionMoveMode(): SelectionMoveMode {
        return this.selectionMoveMoveOverride ?? { kind: 'OnlyMoveCursorSelections', updateUnchangedSelections: this.isVimExtensionInstalled }
    }

    collectSelections(): Range[] {
        return this.textEditor.selections.map(s => fromVsCodeRange(s, this.textEditor.document))
    }

    setSelections(selections: Range[]): void {
        this.textEditor.selections = selections.map(s => {
            const vr = toVsCodeRange(s, this.textEditor.document)
            return new Selection(vr.start, vr.end)
        })
    }

    async replaceAbbreviations(changes: Change[]): Promise<boolean> {
        let ok = false
        let retries = 0
        try {
            // The user may have changed the text document in-between `this.textEditor` being updated
            // (when the call to the extension was started) and `this.textEditor.edit()` being executed.
            // In this case, since the state of the editor that the extension sees and the state that
            // the user sees are different, VS Code will reject the edit.
            // This occurs especially often in setups with increased latency until the extension is triggered,
            // e.g. an SSH setup. Since VS Code does not appear to support an atomic read -> write operation,
            // unfortunately the only thing we can do here is to retry.
            while (!ok && retries < 10) {
                ok = await this.textEditor.edit(builder => {
                    for (const c of changes) {
                        builder.replace(toVsCodeRange(c.range, this.textEditor.document), c.newText)
                    }
                })
                retries++
            }
        } catch (e) {
            this.writeError('Error while replacing abbreviation: ' + e)
        }
        return ok
    }

    async replaceAllTrackedAbbreviations() {
        await this.rewriter.replaceAllTrackedAbbreviations()
        this.updateState()
    }

    private updateState() {
        const trackedAbbreviations = this.rewriter.getTrackedAbbreviations()

        this.textEditor.setDecorations(
            this.decorationType,
            [...trackedAbbreviations].map(a => toVsCodeRange(a.range, this.textEditor.document)),
        )

        void this.setInputActive(trackedAbbreviations.size > 0)
    }

    private async setInputActive(isActive: boolean) {
        await commands.executeCommand('setContext', 'lean4.input.isActive', isActive)
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}

function fromVsCodeRange(range: LineColRange, doc: TextDocument): Range {
    const start = doc.offsetAt(range.start)
    const end = doc.offsetAt(range.end)
    return new Range(start, end - start)
}

function toVsCodeRange(range: Range, doc: TextDocument): LineColRange {
    const start = doc.positionAt(range.offset)
    const end = doc.positionAt(range.offsetEnd + 1)
    return new LineColRange(start, end)
}
