import { AbbreviationProvider } from '@leanprover/unicode-input'
import { Disposable, languages, TextEditor, window, workspace } from 'vscode'
import { VSCodeAbbreviationConfig } from './VSCodeAbbreviationConfig'
import { VSCodeAbbreviationRewriter } from './VSCodeAbbreviationRewriter'

/**
 * Sets up everything required for the abbreviation rewriter feature.
 * Creates an `AbbreviationRewriter` for the active editor.
 */
export class AbbreviationRewriterFeature {
    private readonly disposables = new Array<Disposable>()

    private visibleTextEditorsByUri = new Map<string, TextEditor[]>()
    private rewriters = new Map<TextEditor, VSCodeAbbreviationRewriter>()

    constructor(
        private readonly config: VSCodeAbbreviationConfig,
        private readonly abbreviationProvider: AbbreviationProvider,
    ) {
        this.changedVisibleTextEditors(window.visibleTextEditors)
        this.disposables.push(
            window.onDidChangeVisibleTextEditors(visibleTextEditors =>
                this.changedVisibleTextEditors(visibleTextEditors),
            ),

            workspace.onDidOpenTextDocument(doc => {
                // Ensure that we create/remove abbreviation rewriters when the language ID changes
                const editors = this.visibleTextEditorsByUri.get(doc.uri.toString())
                if (editors === undefined) {
                    return
                }
                for (const editor of editors) {
                    if (this.shouldEnableRewriterForEditor(editor)) {
                        if (!this.rewriters.has(editor)) {
                            this.rewriters.set(
                                editor,
                                new VSCodeAbbreviationRewriter(config, abbreviationProvider, editor),
                            )
                        }
                    } else {
                        const rewriter = this.rewriters.get(editor)
                        if (rewriter !== undefined) {
                            this.rewriters.delete(editor)
                            rewriter.dispose()
                        }
                    }
                }
            }),
        )
    }

    private changedVisibleTextEditors(visibleTextEditors: readonly TextEditor[]) {
        // Remove all rewriters for invisible editors, add rewriters for new visible editors,
        // reuse old rewriters for editors that are still visible
        const newRewriters = new Map<TextEditor, VSCodeAbbreviationRewriter>()
        for (const editor of visibleTextEditors) {
            if (!this.shouldEnableRewriterForEditor(editor)) {
                continue
            }
            const rewriter =
                this.rewriters.get(editor) ??
                new VSCodeAbbreviationRewriter(this.config, this.abbreviationProvider, editor)
            newRewriters.set(editor, rewriter)
        }
        for (const [oldVisibleEditor, rewriter] of this.rewriters) {
            if (!newRewriters.has(oldVisibleEditor)) {
                rewriter.dispose()
            }
        }
        this.rewriters = newRewriters

        // Update index of visible text editors
        this.visibleTextEditorsByUri = new Map<string, TextEditor[]>()
        for (const editor of visibleTextEditors) {
            const key = editor.document.uri.toString()
            const editors = this.visibleTextEditorsByUri.get(key) ?? []
            editors.push(editor)
            this.visibleTextEditorsByUri.set(key, editors)
        }
    }

    private shouldEnableRewriterForEditor(editor: TextEditor): boolean {
        if (!this.config.inputModeEnabled) {
            return false
        }
        if (!languages.match(this.config.languages, editor.document)) {
            return false
        }
        return true
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
        for (const [_, rewriter] of this.rewriters) {
            rewriter.dispose()
        }
    }
}
