import { AbbreviationProvider } from '@leanprover/unicode-input'
import {
    commands,
    Disposable,
    env,
    QuickInputButton,
    QuickPick,
    QuickPickItem,
    Selection,
    TextEditor,
    ThemeIcon,
    window,
} from 'vscode'
import { groupByKey } from '../utils/groupBy'
import { displayNotification } from '../utils/notifs'
import { VSCodeAbbreviationConfig } from './VSCodeAbbreviationConfig'

const CURSOR_MARKER = '$CURSOR'

type PickerMode = 'find' | 'insert' | 'copy'

interface SymbolPickItem extends QuickPickItem {
    /** Symbol text with the `$CURSOR` marker stripped. */
    symbol: string
    /** Character offset of the original `$CURSOR` marker in `symbol`, or `undefined` if absent. */
    cursorOffset: number | undefined
    /** Abbreviations producing this symbol, *without* the leader, shortest first. */
    abbreviations: string[]
}

/**
 * Registers three commands that open a quick pick of all known Unicode
 * abbreviations:
 *
 *  - `lean4.input.findSymbol` opens the symbol picker and then a second picker
 *    to choose between Copy and Insert. Shown in the ∀ title bar menu.
 *  - `lean4.input.insertSymbol` inserts the chosen symbol into the active text
 *    editor. Bound to a keybinding gated on `editorTextFocus`.
 *  - `lean4.input.copySymbol` copies the chosen symbol to the clipboard, so
 *    users can paste it into non-editor inputs (search view, find widget,
 *    settings, third-party dialogs, etc.). Bound to the same keybinding gated
 *    on `!editorTextFocus`.
 *
 * All commands surface in the Command Palette. The `insertSymbol` and
 * `copySymbol` commands also have per-item buttons for the secondary action.
 */
export class SymbolPickerFeature implements Disposable {
    private readonly disposables: Disposable[] = []

    constructor(
        private readonly config: VSCodeAbbreviationConfig,
        private readonly abbreviations: AbbreviationProvider,
    ) {
        this.disposables.push(
            commands.registerCommand('lean4.input.findSymbol', () => this.showPicker('find')),
            commands.registerCommand('lean4.input.insertSymbol', () => this.showPicker('insert')),
            commands.registerCommand('lean4.input.copySymbol', () => this.showPicker('copy')),
            // Drive the `lean4.input.isTextEditorActive` context key so the
            // Command Palette entry for `insertSymbol` is hidden when there is
            // no text editor to insert into. The built-in `editorIsOpen` is too
            // permissive - it's true even when only a webview or custom editor
            // is open, in which case `window.activeTextEditor` is undefined. The
            // keybinding for `insertSymbol` is already gated on `editorTextFocus`,
            // which implies an active text editor, so it does not need this key.
            window.onDidChangeActiveTextEditor(editor => this.setHasActiveTextEditor(editor !== undefined)),
        )
        void this.setHasActiveTextEditor(window.activeTextEditor !== undefined)
    }

    private async setHasActiveTextEditor(isTextEditorActive: boolean): Promise<void> {
        await commands.executeCommand('setContext', 'lean4.input.isTextEditorActive', isTextEditorActive)
    }

    private buildItems(itemButtons: QuickInputButton[] = []): SymbolPickItem[] {
        const leader = this.config.abbreviationCharacter
        const symbolsByAbbrev = this.abbreviations.getSymbolsByAbbreviation()

        // Group abbreviations by the symbol they produce so the picker shows one
        // row per symbol with all known abbreviations on it. Sort each group
        // shortest first, matching the order returned by
        // `findSymbolsByAbbreviationPrefix` in the in-editor matcher.
        const entries = Object.entries(symbolsByAbbrev)
        const abbrevsBySymbol = groupByKey(entries, ([_, symbol]) => symbol)
        const sortedAbbrevsBySymbol = [...abbrevsBySymbol].map(
            ([rawSymbol, group]) =>
                [
                    rawSymbol,
                    group.map(([abbrev, _]) => abbrev).sort((a, b) => a.length - b.length || a.localeCompare(b)),
                ] as const,
        )

        const items: SymbolPickItem[] = []
        for (const [rawSymbol, abbrevs] of sortedAbbrevsBySymbol) {
            const rawCursorOffset = rawSymbol.indexOf(CURSOR_MARKER)
            const cursorOffset = rawCursorOffset !== -1 ? rawCursorOffset : undefined
            const symbol = cursorOffset !== undefined ? rawSymbol.replace(CURSOR_MARKER, '') : rawSymbol
            items.push({
                label: symbol,
                detail: abbrevs.map(a => leader + a).join(' '),
                // `alwaysShow` keeps the item visible regardless of the built-in
                // matcher's verdict, so our custom filter in `filterItems` is the
                // sole authority on what is shown.
                alwaysShow: true,
                buttons: itemButtons,
                symbol,
                cursorOffset,
                abbreviations: abbrevs,
            })
        }

        return items
    }

    /**
     * Filters and re-orders `allItems` for the current query. There are two
     * matching paths:
     *
     *  - Forward (abbreviation → symbol): case-sensitive *prefix* match against
     *    abbreviations, shortest abbreviation winning. Mirrors the in-editor
     *    matcher (`AbbreviationProvider.findSymbolsByAbbreviationPrefix`).
     *  - Reverse (symbol → abbreviation): substring match against the symbol
     *    itself, so users can paste or type a Unicode character to discover the
     *    abbreviation that produces it.
     *
     * Forward matches come first (sorted by shortest abbreviation), reverse
     * matches follow.
     */
    private filterItems(allItems: readonly SymbolPickItem[], query: string): SymbolPickItem[] {
        if (query.length === 0) {
            return [...allItems]
        }
        // Users may or may not type the leader character — strip it so both
        // `\alp` and `alp` match the same way for the forward path.
        const leader = this.config.abbreviationCharacter
        const stripped = query.startsWith(leader) ? query.slice(leader.length) : query
        if (stripped.length === 0) {
            return [...allItems]
        }
        const abbrMatches: { item: SymbolPickItem; matchLen: number }[] = []
        const symbolMatches: SymbolPickItem[] = []
        for (const item of allItems) {
            // Forward: shortest abbreviation that has `stripped` as a prefix.
            let bestLen = Number.POSITIVE_INFINITY
            for (const abbr of item.abbreviations) {
                if (abbr.startsWith(stripped) && abbr.length < bestLen) {
                    bestLen = abbr.length
                }
            }
            if (bestLen !== Number.POSITIVE_INFINITY) {
                abbrMatches.push({ item, matchLen: bestLen })
                continue
            }
            // Reverse: the user typed (or pasted) part of the symbol itself.
            if (item.symbol.includes(stripped)) {
                symbolMatches.push(item)
            }
        }
        // Stable sort: ties fall back to the alphabetic order set by `buildItems`.
        abbrMatches.sort((a, b) => a.matchLen - b.matchLen)
        return abbrMatches.map(m => m.item).concat(symbolMatches)
    }

    private static readonly insertButton: QuickInputButton = {
        iconPath: new ThemeIcon('edit'),
        tooltip: 'Insert into editor',
    }

    private static readonly copyButton: QuickInputButton = {
        iconPath: new ThemeIcon('copy'),
        tooltip: 'Copy to clipboard',
    }

    private showPicker(mode: PickerMode): void {
        if (mode === 'find') {
            this.showFindPicker(window.activeTextEditor)
        } else {
            this.showDirectPicker(mode, window.activeTextEditor)
        }
    }

    /**
     * Creates a symbol picker with filtering wired up, shows it, and returns
     * it so the caller can attach `onDidAccept` / `onDidTriggerItemButton`.
     */
    private createSymbolPicker(title: string, itemButtons: QuickInputButton[] = []): QuickPick<SymbolPickItem> {
        const allItems = this.buildItems(itemButtons)

        const picker: QuickPick<SymbolPickItem> = window.createQuickPick<SymbolPickItem>()
        picker.title = title
        picker.placeholder = 'Type an abbreviation (e.g. alpha)'
        // The built-in matcher is case-insensitive and cannot be reconfigured.
        // We bypass it: `matchOnDetail` is left off so the matcher only looks at
        // `label` (a unicode symbol that never contains ASCII abbreviation
        // characters), every item is `alwaysShow`, and we drive filtering and
        // ordering ourselves through `onDidChangeValue`.
        picker.matchOnDetail = false
        picker.items = allItems

        picker.onDidChangeValue(value => {
            picker.items = this.filterItems(allItems, value)
        })
        picker.onDidHide(() => picker.dispose())
        picker.show()
        return picker
    }

    /**
     * Opens the symbol picker in "find" mode: Enter opens a second quick pick
     * that lets the user choose between Copy and Insert.
     */
    private showFindPicker(editor: TextEditor | undefined): void {
        const picker = this.createSymbolPicker('Lean 4: Find Unicode Symbol')

        picker.onDidAccept(async () => {
            const selection = picker.selectedItems[0]
            picker.hide()
            if (selection === undefined) {
                return
            }
            await this.showActionPicker(selection, editor)
        })
    }

    /**
     * After a symbol is chosen in "find" mode, shows a second quick pick
     * offering Copy and Insert (if an editor is available).
     */
    private async showActionPicker(item: SymbolPickItem, capturedEditor: TextEditor | undefined): Promise<void> {
        const actions: { label: string; action: () => Promise<void> }[] = [
            { label: `$(copy) Copy ${item.symbol} to clipboard`, action: () => this.copySymbol(item) },
        ]
        if (capturedEditor !== undefined) {
            actions.push({
                label: `$(edit) Insert ${item.symbol} into editor`,
                action: () => this.insertSymbol(item, capturedEditor),
            })
        }

        const chosen = await window.showQuickPick(actions, { title: `Action for ${item.symbol}` })
        if (chosen !== undefined) {
            await chosen.action()
        }
    }

    /**
     * Opens the symbol picker in "insert" or "copy" mode: Enter performs the
     * primary action, an item button performs the secondary action.
     */
    private showDirectPicker(mode: 'insert' | 'copy', editor: TextEditor | undefined): void {
        const secondaryButton = mode === 'insert' ? SymbolPickerFeature.copyButton : SymbolPickerFeature.insertButton
        const title = mode === 'insert' ? 'Lean 4: Insert Unicode Symbol' : 'Lean 4: Copy Unicode Symbol'

        const picker = this.createSymbolPicker(title, [secondaryButton])

        const commitItem = async (item: SymbolPickItem, action: 'insert' | 'copy') => {
            if (action === 'insert') {
                if (editor === undefined) {
                    displayNotification('Error', 'No active text editor to insert into.')
                    return
                }
                await this.insertSymbol(item, editor)
            } else {
                await this.copySymbol(item)
            }
        }
        const secondaryMode: 'insert' | 'copy' = mode === 'insert' ? 'copy' : 'insert'

        picker.onDidAccept(async () => {
            const selection = picker.selectedItems[0]
            picker.hide()
            if (selection === undefined) {
                return
            }
            await commitItem(selection, mode)
        })

        picker.onDidTriggerItemButton(async e => {
            picker.hide()
            await commitItem(e.item, secondaryMode)
        })
    }

    private async insertSymbol(item: SymbolPickItem, targetEditor: TextEditor): Promise<void> {
        const doc = targetEditor.document
        // Pair selections with their original index so we can preserve the
        // order of `targetEditor.selections` (in particular, which one is
        // primary) after the edit. Sort the working list by document offset so
        // we can compute post-edit cursor positions in a single forward pass,
        // tracking the cumulative delta from earlier insertions.
        const indexedSelections = targetEditor.selections
            .map((sel, originalIndex) => ({
                originalIndex,
                startOffset: doc.offsetAt(sel.start),
                endOffset: doc.offsetAt(sel.end),
                sel,
            }))
            .sort((a, b) => a.startOffset - b.startOffset)

        const success = await targetEditor.edit(editBuilder => {
            for (const { sel } of indexedSelections) {
                editBuilder.replace(sel, item.symbol)
            }
        })
        if (!success) {
            displayNotification('Error', `Failed to insert ${item.symbol} into the active editor.`)
            return
        }

        // For symbols with a `$CURSOR` marker (e.g. `(` → `($CURSOR)`) place
        // each caret where the marker was; otherwise put it at the end of the
        // inserted text, which matches the natural caret position after a
        // plain insertion.
        const cursorTargetOffset = item.cursorOffset ?? item.symbol.length
        const newSelections: Selection[] = new Array(indexedSelections.length)
        let delta = 0
        for (const { originalIndex, startOffset, endOffset } of indexedSelections) {
            const postEditStart = startOffset + delta
            delta += item.symbol.length - (endOffset - startOffset)
            const cursorPos = doc.positionAt(postEditStart + cursorTargetOffset)
            newSelections[originalIndex] = new Selection(cursorPos, cursorPos)
        }
        targetEditor.selections = newSelections
        window.setStatusBarMessage(`Inserted ${item.symbol}`, 3000)
    }

    private async copySymbol(item: SymbolPickItem): Promise<void> {
        await env.clipboard.writeText(item.symbol)
        window.setStatusBarMessage(`Copied ${item.symbol} to clipboard`, 3000)
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}
