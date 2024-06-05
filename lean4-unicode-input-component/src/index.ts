import {
    AbbreviationConfig,
    AbbreviationProvider,
    AbbreviationRewriter,
    AbbreviationTextSource,
    Change,
    Range,
    SelectionMoveMode,
} from '@leanprover/unicode-input'

function computeTextOffsetFromNodeOffset(
    searchNode: Node,
    target: Node,
    offsetInTarget: number = 0,
): number | undefined {
    if (searchNode === target) {
        return offsetInTarget
    }
    if (!searchNode.contains(target)) {
        return undefined
    }

    let totalOffset = 0
    for (const childNode of Array.from(searchNode.childNodes)) {
        const childOffset: number | undefined = computeTextOffsetFromNodeOffset(childNode, target, offsetInTarget)
        if (childOffset !== undefined) {
            totalOffset += childOffset
            return totalOffset
        }
        totalOffset += childNode.textContent?.length ?? 0
    }
    return undefined
}

function computeTextRangeFromNodeRange(
    searchNode: Node,
    rangeStart: { node: Node; offset: number } | undefined,
    rangeEnd: { node: Node; offset: number } | undefined,
): Range | undefined {
    let start: number | undefined
    let end: number | undefined
    if (rangeStart) {
        start = computeTextOffsetFromNodeOffset(searchNode, rangeStart.node, rangeStart.offset)
    }
    if (rangeEnd) {
        end = computeTextOffsetFromNodeOffset(searchNode, rangeEnd.node, rangeEnd.offset)
    }

    if (start === undefined) {
        if (end === undefined) {
            return undefined
        } else {
            return new Range(end, 0)
        }
    } else {
        if (end === undefined) {
            return new Range(start, 0)
        } else {
            if (end < start) {
                ;[start, end] = [end, start]
            }
            return new Range(start, end - start)
        }
    }
}

function findTextCursorSelection(searchNode: Node): Range | undefined {
    const sel = window.getSelection()
    if (sel === null) {
        return undefined
    }

    let rangeStart: { node: Node; offset: number } | undefined
    if (sel.anchorNode) {
        rangeStart = { node: sel.anchorNode, offset: sel.anchorOffset }
    }
    let rangeEnd: { node: Node; offset: number } | undefined
    if (sel.focusNode) {
        rangeStart = { node: sel.focusNode, offset: sel.focusOffset }
    }

    return computeTextRangeFromNodeRange(searchNode, rangeStart, rangeEnd)
}

function computeNodeOffsetFromTextOffset(
    searchNode: Node,
    offset: number,
): { found: true; node: Node; offset: number } | { found: false; remainingOffset: number } {
    const childNodes = Array.from(searchNode.childNodes)
    if (childNodes.length === 0) {
        const textContentLength = searchNode.textContent?.length ?? 0
        if (offset > textContentLength) {
            return { found: false, remainingOffset: offset - textContentLength }
        }
        return { found: true, node: searchNode, offset }
    }
    for (const childNode of Array.from(searchNode.childNodes)) {
        const result = computeNodeOffsetFromTextOffset(childNode, offset)
        if (result.found) {
            return result
        }
        offset = result.remainingOffset
    }
    return { found: false, remainingOffset: offset }
}

function setTextCursorSelection(searchNode: Node, offset: number) {
    const result = computeNodeOffsetFromTextOffset(searchNode, offset)
    if (!result.found) {
        return
    }

    const sel = window.getSelection()
    if (sel === null) {
        return
    }

    const range = document.createRange()
    range.setStart(result.node, result.offset)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
}

function replaceAt(str: string, updates: { range: Range; update: (old: string) => string }[]): string {
    updates.sort((u1, u2) => u1.range.offset - u2.range.offset)
    let newStr = ''
    let lastUntouchedPos = 0
    for (const u of updates) {
        newStr += str.slice(lastUntouchedPos, u.range.offset)
        newStr += u.update(str.slice(u.range.offset, u.range.offsetEnd + 1))
        lastUntouchedPos = u.range.offset + u.range.length
    }
    newStr += str.slice(lastUntouchedPos)
    return newStr
}

export class InputAbbreviationRewriter implements AbbreviationTextSource {
    private rewriter: AbbreviationRewriter
    private isInSelectionChange: boolean = false

    constructor(
        private config: AbbreviationConfig,
        private textInput: HTMLElement,
    ) {
        if (!textInput.isContentEditable) {
            throw new Error()
        }

        const provider: AbbreviationProvider = new AbbreviationProvider(config)
        this.rewriter = new AbbreviationRewriter(config, provider, this)

        textInput.addEventListener('beforeinput', async (ev: Event) => {
            const inputEvent = ev as InputEvent
            const targetRange: StaticRange | undefined = inputEvent.getTargetRanges()[0]
            if (targetRange === undefined) {
                return
            }
            const range = computeTextRangeFromNodeRange(
                textInput,
                { node: targetRange.startContainer, offset: targetRange.startOffset },
                { node: targetRange.endContainer, offset: targetRange.endOffset },
            )
            if (range === undefined) {
                return
            }
            const newText = inputEvent.data ?? ''
            const change: Change = { range, newText }
            this.rewriter.changeInput([change])
        })

        textInput.addEventListener('input', async _ => {
            await this.rewriter.triggerAbbreviationReplacement()
            await this.updateSelection()
            this.updateState()
        })

        document.addEventListener('selectionchange', async () => {
            // This happens when updating the state itself triggers a selection change.
            if (this.isInSelectionChange) {
                return
            }
            this.isInSelectionChange = true
            await this.updateSelection()
            this.updateState()
            this.isInSelectionChange = true
        })

        textInput.addEventListener('keydown', async (ev: KeyboardEvent) => {
            if (ev.key === 'Tab') {
                await this.rewriter.replaceAllTrackedAbbreviations()
                this.updateState()
                ev.preventDefault()
            }
        })
    }

    resetAbbreviations() {
        this.rewriter.resetTrackedAbbreviations()
        this.updateState()
    }

    private async updateSelection() {
        const selection = this.getSelection()
        if (selection === undefined) {
            return
        }
        await this.rewriter.changeSelections([selection])
    }

    private getSelection(): Range | undefined {
        return findTextCursorSelection(this.textInput)
    }

    private updateState() {
        const query = this.getInput()
        const queryHtml = this.textInput.innerHTML
        const updates = Array.from(this.rewriter.getTrackedAbbreviations()).map(a => ({
            range: a.range,
            update: (old: string) => `<u>${old}</u>`,
        }))
        const newQueryHtml = replaceAt(query, updates)
        if (queryHtml === newQueryHtml) {
            return
        }
        const selectionBeforeChange = this.getSelection()
        this.setInputHTML(newQueryHtml)
        if (selectionBeforeChange !== undefined) {
            this.setSelections([selectionBeforeChange])
        }
    }

    async replaceAbbreviations(changes: Change[]): Promise<boolean> {
        const updates: { range: Range; update: (old: string) => string }[] = changes.map(c => ({
            range: c.range,
            update: _ => c.newText,
        }))
        this.setInputHTML(replaceAt(this.getInput(), updates))
        return true
    }

    selectionMoveMode(): SelectionMoveMode {
        return { kind: 'MoveAllSelections' }
    }

    collectSelections(): Range[] {
        const selection = this.getSelection()
        if (selection === undefined) {
            return []
        }
        return [selection]
    }

    setSelections(selections: Range[]): void {
        const primarySelection: Range | undefined = selections[0]
        if (primarySelection === undefined) {
            return
        }
        setTextCursorSelection(this.textInput, primarySelection.offset)
    }

    private setInputHTML(html: string) {
        this.textInput.innerHTML = html
    }

    private getInput(): string {
        return this.textInput.innerText
    }
}
