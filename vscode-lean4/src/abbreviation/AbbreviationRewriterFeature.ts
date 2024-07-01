import { AbbreviationProvider } from '@leanprover/unicode-input'
import { commands, Disposable, languages, OutputChannel, TextEditor, window, workspace } from 'vscode'
import { extUriEquals, toExtUri } from '../utils/exturi'
import { VSCodeAbbreviationConfig } from './VSCodeAbbreviationConfig'
import { VSCodeAbbreviationRewriter } from './VSCodeAbbreviationRewriter'

/**
 * Sets up everything required for the abbreviation rewriter feature.
 * Creates an `AbbreviationRewriter` for the active editor.
 */
export class AbbreviationRewriterFeature {
    private readonly disposables = new Array<Disposable>()

    private activeAbbreviationRewriter: VSCodeAbbreviationRewriter | undefined

    constructor(
        private readonly config: VSCodeAbbreviationConfig,
        private readonly abbreviationProvider: AbbreviationProvider,
        private readonly outputChannel: OutputChannel,
    ) {
        void this.changedActiveTextEditor(window.activeTextEditor)

        this.disposables.push(
            commands.registerTextEditorCommand('lean4.input.convert', async () => {
                if (this.activeAbbreviationRewriter === undefined) {
                    return
                }
                await this.activeAbbreviationRewriter.replaceAllTrackedAbbreviations()
            }),

            window.onDidChangeActiveTextEditor(editor => this.changedActiveTextEditor(editor)),

            workspace.onDidOpenTextDocument(async doc => {
                // Ensure that we create/remove abbreviation rewriters when the language ID changes
                if (window.activeTextEditor === undefined) {
                    return
                }
                const editorUri = toExtUri(window.activeTextEditor.document.uri)
                const docUri = toExtUri(doc.uri)
                if (editorUri === undefined || docUri === undefined || !extUriEquals(editorUri, docUri)) {
                    return
                }
                if (
                    this.activeAbbreviationRewriter === undefined &&
                    this.shouldEnableRewriterForEditor(window.activeTextEditor)
                ) {
                    this.activeAbbreviationRewriter = new VSCodeAbbreviationRewriter(
                        config,
                        abbreviationProvider,
                        outputChannel,
                        window.activeTextEditor,
                    )
                } else if (
                    this.activeAbbreviationRewriter !== undefined &&
                    !this.shouldEnableRewriterForEditor(window.activeTextEditor)
                ) {
                    await this.disposeActiveAbbreviationRewriter()
                }
            }),
        )
    }

    private async disposeActiveAbbreviationRewriter() {
        // This is necessary to prevent `disposeActiveAbbreviationRewriter` from racing with
        // other assignments to `this.activeAbbreviationRewriter`.
        const abbreviationRewriterToDispose = this.activeAbbreviationRewriter
        this.activeAbbreviationRewriter = undefined
        if (abbreviationRewriterToDispose === undefined) {
            return
        }

        await abbreviationRewriterToDispose.replaceAllTrackedAbbreviations()
        abbreviationRewriterToDispose.dispose()
    }

    private async changedActiveTextEditor(activeTextEditor: TextEditor | undefined) {
        await this.disposeActiveAbbreviationRewriter()
        if (activeTextEditor === undefined) {
            return
        }
        if (!this.shouldEnableRewriterForEditor(activeTextEditor)) {
            return
        }
        this.activeAbbreviationRewriter = new VSCodeAbbreviationRewriter(
            this.config,
            this.abbreviationProvider,
            this.outputChannel,
            activeTextEditor,
        )
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
        this.activeAbbreviationRewriter?.dispose()
    }
}
