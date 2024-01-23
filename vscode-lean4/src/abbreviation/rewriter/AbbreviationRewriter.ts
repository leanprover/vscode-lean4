import { Range as LineColRange } from 'vscode';
import { commands, Disposable, TextEditor, window, workspace, Selection, OutputChannel, TextDocument } from 'vscode';
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
	private stderrOutput: OutputChannel;
	private firstOutput = true;

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
				if (e.textEditor.document !== this.textEditor.document) {
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
			commands.registerTextEditorCommand('lean4.input.convert', async () =>
				this.forceReplace([...this.trackedAbbreviations])
			)
		);
	}

	private writeError(e: string) {
		this.stderrOutput  = this.stderrOutput || window.createOutputChannel('Lean: Editor');
		this.stderrOutput.appendLine(e);
		if (this.firstOutput){
			this.stderrOutput.show(true);
			this.firstOutput = false;
		}
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

		const replacements = this.computeReplacements(abbreviations)
		const replacingSuccessful = await this.replaceAbbreviations(replacements)

		if (replacingSuccessful) {
			this.moveSelections(replacements)
			this.abbreviationProvider.onAbbreviationsCompleted(this.textEditor);
		} else {
			// If replacing the abbreviation did not succeed, keep it around so that we can re-try next time
			// when the text document was changed, the cursor was moved around or the replacement was triggered
			// manually.
			for (const a of abbreviations) {
				this.trackedAbbreviations.add(a);
			}
		}

		this.updateState();
	}

	private computeReplacements(abbreviations: TrackedAbbreviation[]): {
		range: Range
		newText: string
		cursorOffset?: number | undefined
	}[] {
		const cursorVar = '$CURSOR';
		const replacements = new Array<{
			range: Range
			newText: string
			cursorOffset?: number | undefined
		}>();

		for (const abbr of abbreviations) {
			const symbol = abbr.matchingSymbol;
			if (symbol) {
				const newText = symbol.replace(cursorVar, '');
				let cursorOffset: number | undefined = symbol.indexOf(cursorVar);
				if (cursorOffset === -1) {
					cursorOffset = undefined;
				}
				replacements.push({
					range: abbr.range,
					newText,
					cursorOffset,
				});
			}
		}

		return replacements
	}

	private async replaceAbbreviations(replacements: {
		range: Range;
		newText: string;
		cursorOffset?: number | undefined;
	}[]): Promise<Boolean> {
		// We don't want replaced symbols (e.g. "\") to trigger abbreviations.
		this.dontTrackNewAbbr = true;

		let ok = false;
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
				ok = await this.textEditor.edit((builder) => {
					for (const r of replacements) {
						builder.replace(
							toVsCodeRange(r.range, this.textEditor.document),
							r.newText
						);
					}
				})
				retries++
			}
		} catch (e) {
			this.writeError('Error while replacing abbreviation: ' + e);
		}

		this.dontTrackNewAbbr = false;

		return ok
	}

	private moveSelections(replacements: {
		range: Range;
		newText: string;
		cursorOffset?: number | undefined;
	}[]) {
		// Only move the cursor if there were any abbreviations with $CURSOR.
		// This is important because setting `this.textEditor.selections = this.textEditor.selections`
		// may override changes to the cursor made between the `this.textEditor.edit` call and updating
		// the selection. This is due to `this.textEditor.selections` being only updated on `await`.
		if (!replacements.some(r => r.cursorOffset)) {
			return
		}

		// Process replacements with lowest offset first
		replacements.sort((a, b) => a.range.offset - b.range.offset);

		const afterEditReplacements = new Array<{
			range: Range
			newText: string
			cursorOffset?: number | undefined
		}>();
		let totalOffsetShift = 0
		for (const r of replacements) {
			// Re-adjust range to account for new length and changes in prior lengths.
			const afterEditRange = new Range(r.range.offset + totalOffsetShift, r.newText.length)
			afterEditReplacements.push({
				range: afterEditRange,
				newText: r.newText,
				cursorOffset: r.cursorOffset
			})
			totalOffsetShift += r.newText.length - r.range.length
		}

		const newSelections = this.textEditor.selections
			.map(s => fromVsCodeRange(s, this.textEditor.document))
			.map(s => {
				for (const r of afterEditReplacements) {
					if (!r.cursorOffset) {
						// Only move cursor if abbreviation contained $CURSOR
						continue
					}

					const isCursorAtEndOfAbbreviation = s.offset === r.range.offsetEnd + 1
					// Safety check: Prevents moving the cursor if e.g. the replacement triggered
					// because the selection was moved away from the abbreviation.
					if (isCursorAtEndOfAbbreviation) {
						// Move cursor backwards to the position of $CURSOR
						return s.move(r.cursorOffset - r.newText.length)
					}
				}

				// Cursor not at the end of any abbreviation that contained $CURSOR
				// => Keep it where it is
				return s
			})

		this.textEditor.selections = newSelections.map(s => {
			const vr = toVsCodeRange(s, this.textEditor.document);
			return new Selection(vr.start, vr.end)
		});
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
			'lean4.input.isActive',
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

function fromVsCodeRange(range: LineColRange, doc: TextDocument): Range {
	const start = doc.offsetAt(range.start);
	const end = doc.offsetAt(range.end);
	return new Range(start, end - start);
}

function toVsCodeRange(range: Range, doc: TextDocument): LineColRange {
	const start = doc.positionAt(range.offset);
	const end = doc.positionAt(range.offsetEnd + 1);
	return new LineColRange(start, end);
}
