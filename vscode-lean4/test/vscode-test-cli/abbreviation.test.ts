import * as assert from 'node:assert'
import { commands, workspace } from 'vscode'
import { activateExtension } from '../helpers/activation'
import { showInEditor } from '../helpers/editors'
import { afterEachReset } from '../helpers/teardown'
import { ABBREVIATION_TIMEOUT_MS, pollFor } from '../helpers/timeouts'
import { backspace, typeChars, waitForText } from '../helpers/typing'

// These tests exercise the abbreviation rewriter end-to-end in the extension host
// but do not need a Lean toolchain — untitled Lean docs activate the rewriter on
// language match alone (`lean4.input.languages` defaults to ['lean4', 'lean']).
describe('Abbreviation feature', function () {
    this.timeout(10_000)

    before(activateExtension)

    afterEach(afterEachReset)

    it('replaces a typed abbreviation on the non-alphabetic terminator', async () => {
        const doc = await workspace.openTextDocument({ language: 'lean4' })
        await showInEditor(doc)
        await typeChars('\\alpha ')
        // Wait on the *final* shape, not the first appearance of `α` — without
        // the trailing space the predicate could match an intermediate edit
        // state where the rewriter has substituted the symbol but the
        // terminator hasn't been committed yet, racing the assertion below.
        const text = await waitForText(doc, t => t.endsWith('α '), ABBREVIATION_TIMEOUT_MS, 'alpha')
        assert.strictEqual(text, 'α ')
    })

    it('replaces via the explicit lean4.input.convert command', async () => {
        const doc = await workspace.openTextDocument({ language: 'lean4' })
        await showInEditor(doc)
        await typeChars('\\to')
        await commands.executeCommand('lean4.input.convert')
        const text = await waitForText(doc, t => t.includes('→'), ABBREVIATION_TIMEOUT_MS, 'to')
        assert.strictEqual(text, '→')
    })

    it('auto-closes delimiter abbreviations and places the cursor between them', async () => {
        // `\<>` expands to `⟨⟩` because `<>` is mapped to the template
        // `⟨$CURSOR⟩` — the rewriter strips `$CURSOR` from the text and
        // moves the editor selection to where `$CURSOR` was, i.e. column 1.
        //
        // `<>` is unique-and-complete so the rewriter triggers an EAGER
        // replacement during typing (`eagerReplacementEnabled` defaults to
        // true), which makes the explicit `lean4.input.convert` below a
        // no-op — the tracker was already removed by the eager pass. The
        // `convert` is kept in the script anyway as a regression check
        // that an explicit convert call after an eager replace doesn't
        // throw or perturb state.
        //
        // After the eager replace's `await textEditor.edit` resolves, the
        // rewriter's `forceReplace` continues to `moveSelections` to put
        // the cursor at the `$CURSOR` slot. `waitForText` resolves on the
        // edit's `onDidChangeTextDocument` event, which can fire before
        // that continuation runs — so a one-shot read of `editor.selection`
        // races. Poll until the cursor settles at column 1; a real
        // regression (rewriter not moving the cursor at all) would time out
        // here with the observed column in the message.
        const doc = await workspace.openTextDocument({ language: 'lean4' })
        const editor = await showInEditor(doc)
        await typeChars('\\<>')
        await commands.executeCommand('lean4.input.convert')
        const text = await waitForText(doc, t => t.includes('⟨'), ABBREVIATION_TIMEOUT_MS, 'auto-close')
        assert.strictEqual(text, '⟨⟩')
        await pollFor(
            () => (editor.selection.active.character === 1 ? true : undefined),
            ABBREVIATION_TIMEOUT_MS,
            () =>
                'cursor to settle between the brackets at column 1 ' +
                `(currently line ${editor.selection.active.line}, column ${editor.selection.active.character})`,
        )
        assert.strictEqual(editor.selection.active.line, 0)
    })

    // Backspacing past the leading `\` drops the tracked abbreviation, so a
    // subsequent terminator does not trigger a replacement. Without this
    // behaviour, deleting a typo'd prefix would leave the rewriter primed to
    // expand the next thing the user types — and force them to type more
    // backspaces than they typed forward characters.
    it('cancels an in-progress abbreviation when the leading backslash is backspaced away', async () => {
        const doc = await workspace.openTextDocument({ language: 'lean4' })
        await showInEditor(doc)
        await typeChars('\\al')
        await backspace(3)
        // Type a terminator to give the rewriter the same trigger as the
        // happy-path test — if the abbreviation is still being tracked, this
        // would cause `\al ` (or part of it) to be re-elaborated.
        await typeChars(' ')
        const text = await waitForText(doc, t => t === ' ', ABBREVIATION_TIMEOUT_MS, 'after-backspace')
        assert.strictEqual(text, ' ')
    })

    // When the first character after `\` matches no registered abbreviation
    // prefix, `TrackedAbbreviation.processChange` flips the abbreviation to
    // `_finished = true` with `_text = ''`. Subsequent chars `range.isAfter`
    // the (empty) abbreviation range and don't extend it. On the terminator,
    // `triggerAbbreviationReplacement` filters in the finished tracker but
    // `computeReplacements` skips it (`matchingSymbol` is undefined for the
    // empty abbreviation), so no edit is dispatched and the literal text
    // stays in the buffer verbatim. Locks the "no spurious replacement on
    // unknown abbreviation" contract in case a future change makes the
    // rewriter fall back to e.g. longest-prefix matching. `$` is used as
    // the post-`\` char because no Lean 4 abbreviation starts with `$`,
    // unlike most letters/digits which are real prefixes.
    it('leaves a non-matching abbreviation literal in the buffer', async () => {
        const doc = await workspace.openTextDocument({ language: 'lean4' })
        await showInEditor(doc)
        const literal = '\\$nope '
        await typeChars(literal)
        const text = await waitForText(
            doc,
            t => t.length === literal.length,
            ABBREVIATION_TIMEOUT_MS,
            'no-match-literal',
        )
        assert.strictEqual(text, literal)
    })
})
