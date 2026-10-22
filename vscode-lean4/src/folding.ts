import { commands, Disposable, TextDocumentChangeEvent, TextDocumentContentChangeEvent, TextEditor } from 'vscode'
import { foldProofsByDefault } from './config'
import { FoldingRangesProvidedEvent } from './leanclient'
import { LeanClientProvider } from './utils/clientProvider'
import { lean } from './utils/leanEditorProvider'

/** Zero-based start and end line of a folding range, like in `vscode.FoldingRange`. */
interface LineRange {
    start: number
    end: number
}

interface DocumentFoldingState {
    /**
     * The proof folding ranges of the last folding range response, moved by all edits since then.
     * `undefined` if the last folding range request failed.
     */
    proofRanges: LineRange[] | undefined
    /** Whether `lean4.foldProofsByDefault` must still fold the proofs of the document. */
    isDefaultFoldPending: boolean
}

/**
 * Computes the new line of the end of `line` after `change`.
 * Like VS Code, we track a folding range by the end of its start line and the end of its end line.
 */
function moveLineEnd(line: number, change: TextDocumentContentChangeEvent): number {
    const changeStart = change.range.start.line
    const changeEnd = change.range.end.line
    if (line < changeStart) {
        return line
    }
    const insertedLines = change.text.split('\n').length - 1
    if (line < changeEnd) {
        // The change removed the end of `line`.
        return changeStart + insertedLines
    }
    return line - (changeEnd - changeStart) + insertedLines
}

/** Folds or unfolds the folding ranges that start at the start lines of `ranges` in the focused editor. */
async function setCollapsed(ranges: LineRange[], collapsed: boolean): Promise<void> {
    if (ranges.length === 0) {
        return
    }
    // Without `levels` and `direction`, `editor.fold` folds the parent of a folding range that is already folded.
    await commands.executeCommand(collapsed ? 'editor.fold' : 'editor.unfold', {
        levels: 1,
        direction: 'down',
        selectionLines: ranges.map(r => r.start),
    })
}

/**
 * Provides the commands to fold and unfold all proofs and implements `lean4.foldProofsByDefault`.
 *
 * The folding commands of VS Code select folding ranges by their start line, not by their kind.
 * Thus, we track the proof folding ranges that the language server reports for each document.
 * If the document changed after VS Code received the last folding ranges, a folding command first waits
 * for the folding ranges of the current document version.
 * Thus, we move the proof folding ranges by all edits since the last response of the language server,
 * so that they match the next response.
 */
export class LeanFoldingRangeProvider implements Disposable {
    private subscriptions: Disposable[] = []
    private documentStates: Map<string, DocumentFoldingState> = new Map()

    constructor(clientProvider: LeanClientProvider) {
        this.subscriptions.push(
            clientProvider.didProvideFoldingRanges(e => this.onDidProvideFoldingRanges(e)),
            lean.onDidChangeLeanDocument(e => this.onDidChangeLeanDocument(e)),
            lean.onDidCloseLeanDocument(leanDoc => this.documentStates.delete(leanDoc.doc.uri.toString())),
            lean.onDidChangeActiveLeanEditor(leanEditor => {
                if (leanEditor !== undefined) {
                    this.performDefaultFold(leanEditor.editor)
                }
            }),
            lean.registerLeanEditorCommand('lean4.foldAllProofs', leanEditor =>
                this.setProofsCollapsed(leanEditor.editor, true),
            ),
            lean.registerLeanEditorCommand('lean4.unfoldAllProofs', leanEditor =>
                this.setProofsCollapsed(leanEditor.editor, false),
            ),
        )
    }

    private async setProofsCollapsed(editor: TextEditor, collapsed: boolean) {
        const proofRanges = this.documentStates.get(editor.document.uri.toString())?.proofRanges ?? []
        await setCollapsed(proofRanges, collapsed)
    }

    private onDidProvideFoldingRanges({ document, ranges }: FoldingRangesProvidedEvent) {
        const uri = document.uri.toString()
        let state = this.documentStates.get(uri)
        if (state === undefined) {
            // These are the first folding ranges since the document was opened.
            state = { proofRanges: undefined, isDefaultFoldPending: foldProofsByDefault() }
            this.documentStates.set(uri, state)
        }
        state.proofRanges = ranges?.filter(r => r.isProof).map(r => ({ start: r.start, end: r.end }))

        const activeEditor = lean.activeLeanEditor?.editor
        if (activeEditor?.document.uri.toString() === uri) {
            this.performDefaultFold(activeEditor)
        }
    }

    private onDidChangeLeanDocument(e: TextDocumentChangeEvent) {
        const state = this.documentStates.get(e.document.uri.toString())
        if (state?.proofRanges === undefined) {
            return
        }
        let proofRanges = state.proofRanges
        for (const change of e.contentChanges) {
            proofRanges = proofRanges
                .map(r => ({ start: moveLineEnd(r.start, change), end: moveLineEnd(r.end, change) }))
                .filter(r => r.start < r.end)
        }
        state.proofRanges = proofRanges
    }

    /**
     * Folds all proofs in `editor` if `lean4.foldProofsByDefault` has not done this yet for its document.
     * `editor` must be the active editor.
     */
    private performDefaultFold(editor: TextEditor) {
        const state = this.documentStates.get(editor.document.uri.toString())
        if (state === undefined || !state.isDefaultFoldPending || state.proofRanges === undefined) {
            return
        }
        state.isDefaultFoldPending = false
        // Like `editor.foldingImportsByDefault`, do not fold the proofs that contain a cursor.
        const proofRanges = state.proofRanges.filter(
            r => !editor.selections.some(s => r.start < s.start.line && s.start.line <= r.end),
        )
        // In `onDidProvideFoldingRanges`, VS Code has not received the folding ranges yet.
        // `editor.fold` waits until VS Code has applied them, so we must not wait for `editor.fold` there.
        void setCollapsed(proofRanges, true)
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
