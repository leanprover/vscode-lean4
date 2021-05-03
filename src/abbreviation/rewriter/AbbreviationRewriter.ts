import * as vscode from 'vscode';
import { commands, Disposable, TextEditor, window, workspace } from 'vscode';
import { assert } from '../../utils/assert';
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

	private dontTrackNewAbbr = false;

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
							(this.config.eagerReplacementEnabled.get() &&
								abbr.isAbbreviationUniqueAndComplete)
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

		// Wait for VS Code to trigger `onDidChangeTextEditorSelection`
		await waitForNextTick();

		const cursorVar = '$CURSOR';
		const replacements = new Array<{
			range: Range;
			newText: string;
			transformOffsetInRange: (offset: number) => number;
		}>();
		for (const abbr of abbreviations) {
			const symbol = abbr.matchingSymbol;
			if (symbol) {
				const newText = symbol.replace(cursorVar, '');
				let cursorOffset = symbol.indexOf(cursorVar);
				if (cursorOffset === -1) {
					// position the cursor after the inserted symbol
					cursorOffset = newText.length;
				}
				replacements.push({
					range: abbr.range,
					newText,
					transformOffsetInRange: (offset) => cursorOffset,
				});
			}
		}
		// Process replacements with highest offset first
		replacements.sort((a, b) => b.range.offset - a.range.offset);

		// We cannot rely on VS Code to update the selections -
		// it becomes janky if symbols are inserted that are longer
		// than their abbreviation. It also does not really work for \[[]].
		const newSelections = this.textEditor.selections
			.map((s) => fromVsCodeRange(s, this.textEditor.document))
			.map((s) => {
				// Apply the replacement of abbreviations to the selections.
				let newSel = s;
				for (const r of replacements) {
					if (
						r.range.isBefore(newSel) &&
						!r.range.containsRange(newSel)
					) {
						// don't do this on ` \abbr| `
						newSel = newSel.move(r.newText.length - r.range.length);
					} else if (
						!r.range.isAfter(newSel) ||
						r.range.containsRange(newSel)
					) {
						// do this on ` \abbr| ` or ` \ab|br `
						// newSel and r.range intersect
						const offset = newSel.offset - r.range.offset;
						const newOffset = r.transformOffsetInRange(offset);
						newSel = newSel.move(newOffset - offset);
					}
				}
				return newSel;
			});

		// We don't want replaced symbols (e.g. "\") to trigger abbreviations.
		this.dontTrackNewAbbr = true;
		let ok = false;
		try {
			ok = await this.textEditor.edit((builder) => {
				for (const r of replacements) {
					builder.replace(
						toVsCodeRange(r.range, this.textEditor.document),
						r.newText
					);
				}
			});
		} catch (e) {
			console.error('Error while replacing abbreviation: ', e);
		}
		this.dontTrackNewAbbr = false;

		if (ok) {
			this.textEditor.selections = newSelections.map((s) => {
				const vr = toVsCodeRange(s, this.textEditor.document);
				return new vscode.Selection(vr.start, vr.end);
			});
		}
		else {
			// Our edit did not succeed, do not update the selections.
			// This can happen if `waitForNextTick` waits too long.
			console.warn('Unable to replace abbreviation');
		}

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

		if (
			text === this.config.abbreviationCharacter.get() &&
			!affectedAbbr &&
			!this.dontTrackNewAbbr
		) {
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

function waitForNextTick(): Promise<void> {
	return new Promise((res) => setTimeout(res, 0));
}
