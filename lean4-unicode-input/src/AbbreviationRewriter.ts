import { AbbreviationConfig } from './AbbreviationConfig'
import { AbbreviationProvider } from './AbbreviationProvider'
import { Range } from './Range'
import { TrackedAbbreviation } from './TrackedAbbreviation'

export interface Change {
    range: Range
    newText: string
}

export interface Replacement {
    change: Change
    cursorOffset?: number | undefined
}

export type SelectionMoveMode =
    | { kind: 'OnlyMoveCursorSelections'; updateUnchangedSelections: boolean }
    | { kind: 'MoveAllSelections' }

export interface AbbreviationTextSource {
    replaceAbbreviations(changes: Change[]): Promise<boolean>
    selectionMoveMode(): SelectionMoveMode
    collectSelections(): Range[]
    setSelections(selections: Range[]): void
}

export class AbbreviationRewriter {
    /**
     * All tracked abbreviations are disjoint.
     */
    private readonly trackedAbbreviations = new Set<TrackedAbbreviation>()

    private doNotTrackNewAbbr = false

    constructor(
        private readonly config: AbbreviationConfig,
        private readonly abbreviationProvider: AbbreviationProvider,
        private readonly textSource: AbbreviationTextSource,
    ) {}

    changeInput(changes: Change[]) {
        // We need to process the changes at the bottom first.
        // Otherwise, changes at the top will move spans at the bottom down.
        changes.sort((c1, c2) => c2.range.offset - c1.range.offset)

        for (const c of changes) {
            this.processChange(c)
        }
    }

    async triggerAbbreviationReplacement() {
        // Replace any tracked abbreviation that is either finished or unique.
        await this.forceReplace(
            [...this.trackedAbbreviations].filter(
                abbr => abbr.finished || (this.config.eagerReplacementEnabled && abbr.isAbbreviationUniqueAndComplete),
            ),
        )
    }

    async changeSelections(selections: Range[]) {
        // Replace any tracked abbreviation that lost selection.
        await this.forceReplace(
            [...this.trackedAbbreviations].filter(
                abbr => !selections.some(s => abbr.range.containsRange(s.withLength(0))),
            ),
        )
    }

    async replaceAllTrackedAbbreviations() {
        await this.forceReplace([...this.trackedAbbreviations])
    }

    getTrackedAbbreviations(): Set<TrackedAbbreviation> {
        return this.trackedAbbreviations
    }

    resetTrackedAbbreviations() {
        this.trackedAbbreviations.clear()
    }

    private async forceReplace(abbreviations: TrackedAbbreviation[]): Promise<void> {
        if (abbreviations.length === 0) {
            return
        }
        for (const a of abbreviations) {
            this.trackedAbbreviations.delete(a)
        }

        const replacements = AbbreviationRewriter.computeReplacements(abbreviations)
        replacements.sort((r1, r2) => r1.change.range.offset - r2.change.range.offset)

        const selectionsBeforeReplacement = this.textSource.collectSelections()
        // We do not want replaced symbols (e.g. "\") to trigger abbreviations.
        this.doNotTrackNewAbbr = true
        const replacingSuccessful = await this.textSource.replaceAbbreviations(replacements.map(r => r.change))
        this.doNotTrackNewAbbr = false

        if (replacingSuccessful) {
            this.moveSelections(selectionsBeforeReplacement, replacements)
        } else {
            // If replacing the abbreviation did not succeed, keep it around so that we can re-try next time
            // when the text document was changed, the cursor was moved around or the replacement was triggered
            // manually.
            for (const a of abbreviations) {
                this.trackedAbbreviations.add(a)
            }
        }
    }

    private moveSelections(selectionsBeforeReplacement: Range[], replacements: Replacement[]) {
        const selectionMoveMode = this.textSource.selectionMoveMode()
        if (
            !(
                selectionMoveMode.kind === 'MoveAllSelections' ||
                (selectionMoveMode.kind === 'OnlyMoveCursorSelections' &&
                    (replacements.some(r => r.cursorOffset) || selectionMoveMode.updateUnchangedSelections))
            )
        ) {
            return
        }

        // Process replacements with lowest offset first
        replacements.sort((a, b) => a.change.range.offset - b.change.range.offset)

        const replacementInfo = new Array<{
            rangeBeforeEdit: Range
            rangeAfterEdit: Range
            cursorOffset?: number | undefined
        }>()
        let totalOffsetShift = 0
        for (const r of replacements) {
            const newText = r.change.newText
            const rangeBeforeEdit = r.change.range
            // Re-adjust range to account for new length and changes in prior lengths.
            const rangeAfterEdit = new Range(rangeBeforeEdit.offset + totalOffsetShift, newText.length)
            replacementInfo.push({
                rangeBeforeEdit,
                rangeAfterEdit,
                cursorOffset: r.cursorOffset,
            })
            totalOffsetShift += newText.length - rangeBeforeEdit.length
        }

        let selectionsAfterReplacement: Range[]
        switch (selectionMoveMode.kind) {
            case 'OnlyMoveCursorSelections':
                selectionsAfterReplacement = this.textSource.collectSelections()
                break
            case 'MoveAllSelections':
                selectionsAfterReplacement = selectionsBeforeReplacement.map(s => {
                    if (replacementInfo.length === 0) {
                        return s
                    }
                    // Cursor is before all abbreviations
                    if (s.offset < replacementInfo[0]!.rangeBeforeEdit.offset) {
                        return s
                    }
                    // Cursor is after all abbreviations
                    const lastInfo = replacementInfo[replacementInfo.length - 1]!
                    if (s.offset > lastInfo.rangeBeforeEdit.offsetEnd) {
                        return new Range(
                            lastInfo.rangeAfterEdit.offsetEnd + (s.offset - lastInfo.rangeBeforeEdit.offsetEnd),
                            0,
                        )
                    }
                    // Cursor is either in an abbreviation or between two abbreviations
                    for (const info of replacementInfo) {
                        if (s.offset >= info.rangeBeforeEdit.offset && s.offset <= info.rangeBeforeEdit.offsetEnd) {
                            return new Range(info.rangeAfterEdit.offsetEnd + 1, 0)
                        }
                        if (s.offset < info.rangeBeforeEdit.offset) {
                            return new Range(info.rangeAfterEdit.offset - (info.rangeBeforeEdit.offset - s.offset), 0)
                        }
                    }
                    return s
                })
        }

        const newSelections = selectionsAfterReplacement.map(s => {
            for (const info of replacementInfo) {
                if (info.cursorOffset === undefined) {
                    // Only move cursor if abbreviation contained $CURSOR
                    continue
                }

                const isCursorAtEndOfAbbreviation = s.offset === info.rangeAfterEdit.offsetEnd + 1
                // Safety check: Prevents moving the cursor if e.g. the replacement triggered
                // because the selection was moved away from the abbreviation.
                if (isCursorAtEndOfAbbreviation) {
                    // Move cursor to the position of $CURSOR
                    return new Range(info.rangeAfterEdit.offset + info.cursorOffset, s.length)
                }
            }

            return s
        })
        this.textSource.setSelections(newSelections)
    }

    private static computeReplacements(abbreviations: TrackedAbbreviation[]): Replacement[] {
        const cursorVar = '$CURSOR'
        const replacements = new Array<Replacement>()

        for (const abbr of abbreviations) {
            const symbol = abbr.matchingSymbol
            if (symbol) {
                const newText = symbol.replace(cursorVar, '')
                let cursorOffset: number | undefined = symbol.indexOf(cursorVar)
                if (cursorOffset === -1) {
                    cursorOffset = undefined
                }
                replacements.push({
                    change: { range: abbr.range, newText },
                    cursorOffset,
                })
            }
        }

        return replacements
    }

    private processChange(c: Change): void {
        let isAnyTrackedAbbrAffected = false
        for (const abbr of [...this.trackedAbbreviations]) {
            const { isAffected, shouldStopTracking } = abbr.processChange(c.range, c.newText)
            if (isAffected) {
                isAnyTrackedAbbrAffected = true
            }
            if (shouldStopTracking) {
                this.trackedAbbreviations.delete(abbr)
            }
        }

        if (c.newText === this.config.abbreviationCharacter && !isAnyTrackedAbbrAffected && !this.doNotTrackNewAbbr) {
            const abbr = new TrackedAbbreviation(new Range(c.range.offset + 1, 0), '', this.abbreviationProvider)
            this.trackedAbbreviations.add(abbr)
        }
    }
}
