import { observable } from 'mobx';
import { Disposable, languages, TextEditor, window } from 'vscode';
import { autorunDisposable } from '../../utils/autorunDisposable';
import { AbbreviationProvider } from '../AbbreviationProvider';
import { AbbreviationConfig } from '../config';
import { AbbreviationRewriter } from './AbbreviationRewriter';

/**
 * Sets up everything required for the abbreviation rewriter feature.
 * Creates an `AbbreviationRewriter` for the active editor.
 */
export class AbbreviationRewriterFeature {
	private readonly disposables = new Array<Disposable>();

	@observable
	private activeTextEditor: TextEditor | undefined;

	constructor(
		private readonly config: AbbreviationConfig,
		abbreviationProvider: AbbreviationProvider
	) {
		this.activeTextEditor = window.activeTextEditor;

		this.disposables.push(
			window.onDidChangeActiveTextEditor((e) => {
				this.activeTextEditor = e;
			}),
			autorunDisposable((disposables) => {
				if (this.activeTextEditor && this.shouldEnableRewriterForEditor(this.activeTextEditor)) {
					// This creates an abbreviation rewriter for the active text editor.
					// Old rewriters are disposed automatically.
					// This is also updated when this feature is turned off/on.
					disposables.push(
						new AbbreviationRewriter(
							config,
							abbreviationProvider,
							this.activeTextEditor
						)
					);
				}
			})
		);
	}

	private shouldEnableRewriterForEditor(editor: TextEditor): boolean {
		if (!this.config.inputModeEnabled) {
			return false;
		}
		if (!languages.match(this.config.languages.get(), editor.document)) {
			return false;
		}
		return true;
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
