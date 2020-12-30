import * as vscode from 'vscode';
import { commands, Disposable, TextEditor, window, workspace } from 'vscode';
import { assert } from '../../../utils/assert';
import { AbbreviationProvider } from '../AbbreviationProvider';
import { AbbreviationConfig } from '../config';
import { Range } from './Range';
import { TrackedAbbreviation } from './TrackedAbbreviation';

/**
 * Tracks abbreviations in a given text editor and replaces them when dynamically.
 */
export class AbbreviationRewriter {
	private readonly disposables = new Array<Disposable>();
	/**
	 * All tracked abbreviations are disjoint.
	 */
	private readonly trackedAbbreviations = new Set<TrackedAbbreviation>();
	private readonly decorationType = window.createTextEditorDecorationType({
		textDecoration: 'underline',
	});

	private ignoreTextChange = false;

	constructor(
		private readonly config: AbbreviationConfig,
		private readonly abbreviationProvider: AbbreviationProvider,
		private readonly textEditor: TextEditor
	) {
		this.disposables.push(this.decorationType);

		this.disposables.push(
			workspace.onDidChangeTextDocument((e) => {
				if (e.document !== this.textEditor.document) {
					return;
				}
				if (this.ignoreTextChange) {
					return;
				}

				const changes = e.contentChanges.slice(0);
				// We need to process the changes at the bottom first.
				// Otherwise, changes at the top will move spans at the bottom down.
				changes.sort((c1, c2) => c2.rangeOffset - c1.rangeOffset);

				for (const c of changes) {
					const range = new Range(c.rangeOffset, c.rangeLength);
					this.processChange(range, c.text);
				}

				this.updateState();

				// Replace any tracked abbreviation that is either finished or unique.
				void this.forceReplace(
					[...this.trackedAbbreviations].filter(
						(abbr) =>
							abbr.finished ||
							abbr.isAbbreviationUniqueAndComplete
					)
				);
			})
		);
		this.disposables.push(
			window.onDidChangeTextEditorSelection((e) => {
				if (e.textEditor !== this.textEditor) {
					return;
				}

				// Replace any tracked abbreviation that lost selection.
				void this.forceReplace(
					[...this.trackedAbbreviations].filter(
						(abbr) =>
							!e.selections.some((s) =>
								abbr.range.containsRange(
									fromVsCodeRange(
										s,
										e.textEditor.document
									).withLength(0)
								)
							)
					)
				);
			})
		);

		this.disposables.push(
			commands.registerTextEditorCommand('lean.input.convert', async () =>
				this.forceReplace([...this.trackedAbbreviations])
			)
		);
	}

	private async forceReplace(
		abbreviations: TrackedAbbreviation[]
	): Promise<void> {
		if (abbreviations.length === 0) {
			return;
		}
		for (const a of abbreviations) {
			this.trackedAbbreviations.delete(a);
		}

		// We don't want replaced symbols (e.g. "\") to trigger abbreviations.
		this.ignoreTextChange = true;
		try {
			const selections = this.textEditor.selections.map((s) =>
				fromVsCodeRange(s, this.textEditor.document)
			);
			const selectedAbbreviations = abbreviations
				.map((abbr) => ({
					abbr,
					selection: selections.find((s) =>
						abbr.range.containsRange(s)
					),
				}))
				.filter(
					(abbr) =>
						abbr.selection !== undefined &&
						abbr.abbr.matchingSymbol !== undefined
				);

			const unrelatedSelections = selections.filter(
				(s) => !selectedAbbreviations.some((a) => a.selection === s)
			);

			const cursorVar = '$CURSOR';
			const updatedAbbrevSelections = selectedAbbreviations
				.map((a) => a.abbr)
				.map((abbr) => {
					const s = abbr.matchingSymbol || '';
					let cursorOffset = s.indexOf(cursorVar);
					if (cursorOffset === -1) {
						// position the cursor after the inserted symbol
						cursorOffset = s.length;
					}
					return new Range(abbr.range.offset + cursorOffset, 0);
				});

			this.textEditor.selections = unrelatedSelections
				.concat(updatedAbbrevSelections)
				.map((r) => {
					const vr = toVsCodeRange(r, this.textEditor.document);
					return new vscode.Selection(vr.start, vr.end);
				});

			await this.textEditor.edit((builder) => {
				for (const abbr of abbreviations) {
					if (abbr.matchingSymbol) {
						builder.replace(
							toVsCodeRange(abbr.range, this.textEditor.document),
							abbr.matchingSymbol.replace(cursorVar, '')
						);
					}
				}
			});
		} catch (e) {
			console.error('Error while replacing abbreviation: ', e);
		}
		this.ignoreTextChange = false;
		this.updateState();
	}

	private updateState() {
		this.textEditor.setDecorations(
			this.decorationType,
			[...this.trackedAbbreviations].map((a) =>
				toVsCodeRange(a.range, this.textEditor.document)
			)
		);

		void this.setInputActive(this.trackedAbbreviations.size > 0);
	}

	private async setInputActive(isActive: boolean) {
		await commands.executeCommand(
			'setContext',
			'lean.input.isActive',
			isActive
		);
	}

	private processChange(
		range: Range,
		text: string
	): { affectedAbbr: TrackedAbbreviation | undefined } {
		let affectedAbbr: TrackedAbbreviation | undefined;
		for (const abbr of [...this.trackedAbbreviations]) {
			const { isAffected, shouldStopTracking } = abbr.processChange(
				range,
				text
			);
			if (isAffected) {
				// At most one abbreviation should be affected
				assert(() => !affectedAbbr);
				affectedAbbr = abbr;
			}
			if (shouldStopTracking) {
				this.trackedAbbreviations.delete(abbr);
			}
		}

		if (text === this.config.abbreviationCharacter.get() && !affectedAbbr) {
			const abbr = new TrackedAbbreviation(
				new Range(range.offset + 1, 0),
				'',
				this.abbreviationProvider
			);
			this.trackedAbbreviations.add(abbr);
		}
		return { affectedAbbr };
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}

function fromVsCodeRange(range: vscode.Range, doc: vscode.TextDocument): Range {
	const start = doc.offsetAt(range.start);
	const end = doc.offsetAt(range.end);
	return new Range(start, end - start);
}

function toVsCodeRange(range: Range, doc: vscode.TextDocument): vscode.Range {
	const start = doc.positionAt(range.offset);
	const end = doc.positionAt(range.offsetEnd + 1);
	return new vscode.Range(start, end);
}
