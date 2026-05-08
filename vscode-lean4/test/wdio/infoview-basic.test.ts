/// <reference types="wdio-vscode-service" />
import { browser, expect } from '@wdio/globals'
import {
    isInfoViewOpen,
    moveCursorTo,
    openFixtureFile,
    runCommand,
    waitForInfoView,
    withInfoView,
} from '../helpers/wdio'

// InfoView UI tests driven through wdio-vscode-service.

describe('InfoView', function () {
    // Fixture layout (0-indexed):
    //   5: `  rfl`  — goal `1 + 1 = 2`
    //   8: `  rfl`  — goal `2 + 2 = 4`

    // Pause/pin state is sticky across tests in this file (one VS Code
    // instance for the whole wdio run). The pin/pause tests below clean up
    // their own state on the happy path, but a mid-flow failure would leave
    // the InfoView paused or pinned — and subsequent tests would then time
    // out in `waitForInfoView` because the frozen InfoView never updates to
    // their cursor. Clear any leftover toggle state defensively. Errors are
    // swallowed so afterEach can never mask the actual test failure.
    afterEach(async () => {
        if (!(await isInfoViewOpen())) return
        try {
            await withInfoView(async () => {
                // Unpause every paused goal-display. Iterate via `$$` because
                // pin can create multiple displays, each with its own pause.
                for (const btn of await browser.$$('a[data-id="toggle-paused"].codicon-debug-continue')) {
                    await btn.click()
                }
                // Unpin every pinned goal copy.
                for (const btn of await browser.$$('a[data-id="toggle-pinned"].codicon-pinned')) {
                    await btn.click()
                }
            })
        } catch {
            // Best-effort cleanup; mustn't mask test failures.
        }
    })

    it('renders the goal of the first theorem', async () => {
        await openFixtureFile('Main.lean')
        await moveCursorTo(5, 2)
        await waitForInfoView(t => t.includes('1 + 1 = 2'), { label: 'goal `1 + 1 = 2`' })
    })

    it('updates the goal when the cursor moves to a different tactic position', async () => {
        // Seed a known starting state — don't rely on the previous test leaving
        // Main.lean open or the cursor at a particular spot.
        await openFixtureFile('Main.lean')
        await moveCursorTo(5, 2)
        await waitForInfoView(t => t.includes('1 + 1 = 2'), {
            label: 'goal `1 + 1 = 2` rendered at starting cursor',
            timeout: 2 * 60_000,
        })

        // Move to the second `rfl`.
        await moveCursorTo(8, 2)
        await waitForInfoView(t => t.includes('2 + 2 = 4') && !t.includes('1 + 1 = 2'), {
            label: 'goal updated to `2 + 2 = 4`',
            timeout: 60_000,
        })

        // And back again, to confirm the update is bidirectional.
        await moveCursorTo(5, 2)
        await waitForInfoView(t => t.includes('1 + 1 = 2') && !t.includes('2 + 2 = 4'), {
            label: 'goal updated back to `1 + 1 = 2`',
            timeout: 60_000,
        })
    })

    // Errors.lean layout (0-indexed):
    //   5: `  rfl`              — part of an `example` that fails with a type mismatch
    //   7: `#check (1 + 1 : Nat)` — always emits info `1 + 1 : Nat`
    it('shows the error message when the cursor is on the failing tactic', async () => {
        await openFixtureFile('Errors.lean')
        await moveCursorTo(5, 2)
        // The type-mismatch error rendering includes the expected type `1 + 1 = 3`.
        await waitForInfoView(t => t.includes('1 + 1 = 3'), {
            label: 'error message for `1 + 1 = 3` visible',
            timeout: 2 * 60_000,
        })
    })

    it('shows the `#check` info message when the cursor is on the command', async () => {
        await openFixtureFile('Errors.lean')
        await moveCursorTo(7, 0)
        await waitForInfoView(t => /1 \+ 1[\s\S]*:[\s\S]*Nat/.test(t), {
            label: '`1 + 1 : Nat` info message visible',
            timeout: 2 * 60_000,
        })
    })

    it('tracks the active editor when switching tabs', async () => {
        // Explicitly set up both files with known cursor positions rather than
        // relying on state left behind by earlier tests.
        await openFixtureFile('Main.lean')
        await moveCursorTo(5, 2)
        await waitForInfoView(t => t.includes('1 + 1 = 2'), {
            label: 'Main.lean cursor goal rendered',
            timeout: 2 * 60_000,
        })

        await openFixtureFile('Errors.lean')
        await moveCursorTo(7, 0)
        await waitForInfoView(t => /1 \+ 1[\s\S]*:[\s\S]*Nat/.test(t), {
            label: 'Errors.lean cursor info rendered',
            timeout: 2 * 60_000,
        })

        // Switch back to Main.lean — its cursor is still on line 5.
        await openFixtureFile('Main.lean')
        await waitForInfoView(t => t.includes('1 + 1 = 2') && !t.includes('1 + 1 = 3'), {
            label: 'InfoView switched back to Main.lean',
            timeout: 60_000,
        })

        // Switch back to Errors.lean, whose cursor is on the `#check` line.
        await openFixtureFile('Errors.lean')
        await waitForInfoView(
            t => /1 \+ 1[\s\S]*:[\s\S]*Nat/.test(t) && !t.includes('1 + 1 = 2'),
            { label: 'InfoView switched back to Errors.lean', timeout: 60_000 },
        )
    })

    it('can be closed and reopened via the toggle command', async () => {
        // Explicit starting state: Errors.lean with the cursor on the `#check`
        // line so the InfoView has something distinctive to hide and restore.
        await openFixtureFile('Errors.lean')
        await moveCursorTo(7, 0)
        await waitForInfoView(t => /1 \+ 1[\s\S]*:[\s\S]*Nat/.test(t), {
            label: 'InfoView shows `#check` info before toggle',
            timeout: 2 * 60_000,
        })

        await runCommand('lean4.toggleInfoview')
        await browser.waitUntil(async () => !(await isInfoViewOpen()), {
            timeout: 30_000,
            interval: 500,
            timeoutMsg: 'InfoView tab still present after toggle',
        })

        await runCommand('lean4.toggleInfoview')
        await browser.waitUntil(isInfoViewOpen, {
            timeout: 30_000,
            interval: 500,
            timeoutMsg: 'InfoView tab never reappeared after second toggle',
        })
        await waitForInfoView(t => /1 \+ 1[\s\S]*:[\s\S]*Nat/.test(t), {
            label: 'InfoView restored after second toggle',
            timeout: 60_000,
        })
    })

    // Hover.lean layout (0-indexed):
    //   3: `example (n : Nat) : n + 0 = n := by`
    //   4: `  sorry`  — goal `n + 0 = n` with hoverable identifiers
    it('shows a popup when hovering an identifier in a goal, including nested hovers', async () => {
        await openFixtureFile('Hover.lean')
        await moveCursorTo(4, 2)

        // Wait for the goal to render first.
        await waitForInfoView(t => /n \+ 0 = n/.test(t), {
            label: 'goal `n + 0 = n` rendered',
            timeout: 2 * 60_000,
        })

        await withInfoView(async () => {
            // Identifiers are rendered as spans whose text is the identifier
            // name. Tooltips have class `tooltip` and are appended to
            // document.body when an identifier is hovered.
            const natTarget = await browser.$("//span[normalize-space(text())='Nat']")
            await natTarget.waitForExist({ timeout: 10_000 })
            await natTarget.moveTo()

            const firstTooltip = await browser.$('.tooltip')
            await firstTooltip.waitForExist({ timeout: 15_000 })
            await expect((await firstTooltip.getText()).length).toBeGreaterThan(0)

            // The `Nat` tooltip shows its signature, which contains the
            // identifier `Type`. Hover it to open a nested tooltip.
            const typeTarget = await browser.$(
                "//div[contains(@class,'tooltip')]//span[normalize-space(text())='Type']",
            )
            await typeTarget.waitForExist({ timeout: 10_000 })
            await typeTarget.moveTo()

            await browser.waitUntil(
                async () => (await browser.$$('.tooltip')).length >= 2,
                {
                    timeout: 15_000,
                    interval: 250,
                    timeoutMsg: 'expected a nested tooltip to appear',
                },
            )
        })
    })

    it('shows an "All Messages" panel listing every diagnostic in the file', async () => {
        await openFixtureFile('Errors.lean')
        // Move the cursor off the error so the cursor-goal display isn't what
        // surfaces the "1 + 1 = 3" text — we want to verify it's in the All
        // Messages list specifically.
        await moveCursorTo(0, 0)

        // The All Messages Details starts collapsed by default
        // (lean4.infoview.autoOpenShowsGoal is true). Wait for the header,
        // then click to expand, then verify the error is listed inside.
        await waitForInfoView(t => /All Messages/.test(t), {
            label: 'All Messages panel header visible',
            timeout: 3 * 60_000,
        })

        // Work around a known race: initial All Messages population can miss
        // diagnostics emitted during file elaboration. Restarting the file
        // forces a fresh publish that All Messages reliably picks up.
        await runCommand('lean4.restartFile')

        await withInfoView(async () => {
            const details = await browser.$("//details[.//summary[contains(., 'All Messages')]]")
            await details.waitForExist({ timeout: 10_000 })
            if ((await details.getAttribute('open')) === null) {
                const summary = await details.$('summary')
                await summary.click()
            }
            await browser.waitUntil(
                async () => (await browser.$('body').getText()).includes('1 + 1 = 3'),
                {
                    timeout: 2 * 60_000,
                    interval: 500,
                    timeoutMsg: 'expected `1 + 1 = 3` in All Messages body after expand',
                },
            )
        })
    })

    it('toggles the "All Messages" pause state via the pause button', async () => {
        // Explicit starting state: any file with an active InfoView so the
        // All Messages panel has something to pause. Use Errors.lean because
        // its diagnostics guarantee messages in the panel.
        await openFixtureFile('Errors.lean')
        await moveCursorTo(0, 0)
        await waitForInfoView(t => /All Messages/.test(t), {
            label: 'All Messages panel visible before pause toggle',
            timeout: 3 * 60_000,
        })

        await withInfoView(async () => {
            const pauseBtn = await browser.$('a[data-id="pause-all-messages"]')
            await pauseBtn.waitForExist({ timeout: 10_000 })
            await pauseBtn.click()

            const unpauseBtn = await browser.$('a[data-id="unpause-all-messages"]')
            await unpauseBtn.waitForExist({ timeout: 10_000 })
            await unpauseBtn.click()

            const pauseBtnAgain = await browser.$('a[data-id="pause-all-messages"]')
            await pauseBtnAgain.waitForExist({ timeout: 10_000 })
        })
    })

    it('pinning a goal keeps it visible after the cursor moves; unpinning removes it', async () => {
        await openFixtureFile('Main.lean')
        await moveCursorTo(5, 2)
        await waitForInfoView(t => t.includes('1 + 1 = 2'), {
            label: 'goal `1 + 1 = 2` rendered before pinning',
            timeout: 2 * 60_000,
        })

        await withInfoView(async () => {
            // Select by codicon class rather than `[title="…"]` — the title
            // is human-readable copy that may be reworded; codicon names are
            // VS Code's stable icon-font identifiers and double as state
            // indicators (`codicon-pin` = unpinned/ready-to-pin,
            // `codicon-pinned` = pinned/ready-to-unpin). See `info.tsx:121`.
            const pinBtn = await browser.$('a[data-id="toggle-pinned"].codicon-pin')
            await pinBtn.waitForExist({ timeout: 10_000 })
            await pinBtn.click()
            // A "(pinned)" status label appears on the pinned InfoDisplay.
            await browser.waitUntil(
                async () => (await browser.$('body').getText()).includes('(pinned)'),
                { timeout: 10_000, interval: 250, timeoutMsg: 'expected `(pinned)` label after pin click' },
            )
        })

        await moveCursorTo(8, 2)
        // Both goals should be visible: the pinned one at `1 + 1 = 2` and the
        // cursor one at `2 + 2 = 4`.
        await waitForInfoView(
            t => t.includes('1 + 1 = 2') && t.includes('2 + 2 = 4'),
            { label: 'pinned and cursor goals both visible', timeout: 60_000 },
        )

        await withInfoView(async () => {
            const unpinBtn = await browser.$('a[data-id="toggle-pinned"].codicon-pinned')
            await unpinBtn.waitForExist({ timeout: 10_000 })
            await unpinBtn.click()
        })

        // After unpin, only the cursor goal remains.
        await waitForInfoView(
            t => t.includes('2 + 2 = 4') && !t.includes('1 + 1 = 2') && !t.includes('(pinned)'),
            { label: 'pinned goal disappears after unpin', timeout: 60_000 },
        )
    })

    it('pausing a goal freezes it; unpausing lets it track the cursor again', async () => {
        await openFixtureFile('Main.lean')
        await moveCursorTo(5, 2)
        await waitForInfoView(t => t.includes('1 + 1 = 2'), {
            label: 'goal `1 + 1 = 2` rendered before pausing',
            timeout: 2 * 60_000,
        })

        await withInfoView(async () => {
            const pauseBtn = await browser.$('a[data-id="toggle-paused"].codicon-debug-pause')
            await pauseBtn.waitForExist({ timeout: 10_000 })
            await pauseBtn.click()
            await browser.waitUntil(
                async () => (await browser.$('body').getText()).includes('(paused)'),
                { timeout: 10_000, interval: 250, timeoutMsg: 'expected `(paused)` label after pause click' },
            )
        })

        // Moving the cursor to the second rfl would normally swap the goal to
        // `2 + 2 = 4`; while paused, the InfoView must continue to show the
        // frozen `1 + 1 = 2`. Poll for 2s and fail the instant the forbidden
        // text shows up, rather than sleeping a fixed 2s and hoping.
        await moveCursorTo(8, 2)
        await withInfoView(async () => {
            const watchdogDeadline = Date.now() + 2000
            while (Date.now() < watchdogDeadline) {
                const body = await browser.$('body').getText()
                if (body.includes('2 + 2 = 4')) {
                    throw new Error(
                        'paused InfoView updated to `2 + 2 = 4` despite the `(paused)` label being set',
                    )
                }
                if (!body.includes('1 + 1 = 2')) {
                    throw new Error('paused InfoView dropped the frozen `1 + 1 = 2` goal')
                }
                await browser.pause(200)
            }
            // Final snapshot for the assertion log.
            const body = await browser.$('body').getText()
            await expect(body).toContain('1 + 1 = 2')
            await expect(body).not.toContain('2 + 2 = 4')

            const unpauseBtn = await browser.$('a[data-id="toggle-paused"].codicon-debug-continue')
            await unpauseBtn.waitForExist({ timeout: 10_000 })
            await unpauseBtn.click()
        })

        await waitForInfoView(
            t => t.includes('2 + 2 = 4') && !t.includes('(paused)'),
            { label: 'goal updates to `2 + 2 = 4` after unpause', timeout: 60_000 },
        )
    })

    // Trace.lean layout (0-indexed):
    //   3: `set_option trace.Elab.step true in`
    //   4: `#check (0 : Nat)`  — produces a message containing trace data
    it('toggles the trace-search widget on a message that carries trace data', async () => {
        await openFixtureFile('Trace.lean')
        await moveCursorTo(0, 0)

        await waitForInfoView(t => /All Messages/.test(t), {
            label: 'All Messages panel ready',
            timeout: 3 * 60_000,
        })

        await withInfoView(async () => {
            // The search-toggle icon only appears once the server reports
            // `highlightMatchesProvider` and the message contains trace data.
            const showSearch = await browser.$('a[data-id="show-trace-search"]')
            await showSearch.waitForExist({ timeout: 60_000 })
            await showSearch.click()

            const searchInput = await browser.$('.trace-search')
            await searchInput.waitForExist({ timeout: 10_000 })

            const hideSearch = await browser.$('a[data-id="hide-trace-search"]')
            await hideSearch.waitForExist({ timeout: 10_000 })
            // Use a JS-driven `.click()` (HTMLElement.click via
            // `browser.execute`) rather than wdio's geometry-based click.
            // The toggle is a zero-content `<a>` whose visible glyph comes
            // from a `::before` pseudo-element; wdio's "click the element's
            // center" can collapse to a coordinate intercepted by something
            // visually behind the icon (a blank span, the message body),
            // and the click never reaches the anchor's `onClick`. The JS
            // form dispatches the event directly on the element. Param is
            // `any`-typed because the test tsconfig doesn't include the
            // `dom` lib (these tests run in Node; only the inner callback
            // is rehydrated in the browser context).
            await browser.execute((el: any) => el.click(), hideSearch)

            // After hiding, the search widget should be gone.
            await browser.waitUntil(
                async () => !(await browser.$('.trace-search').isExisting()),
                { timeout: 10_000, interval: 250, timeoutMsg: 'trace-search widget still present after hide' },
            )
        })
    })

    // GoToDef.lean layout (0-indexed):
    //   3: `def foo : Nat := 42`
    //   6: `  sorry`  — goal `foo = 42`
    it('jumps the editor to the definition when ctrl-clicking an identifier in a goal', async () => {
        await openFixtureFile('GoToDef.lean')
        await moveCursorTo(6, 2)

        await waitForInfoView(t => /foo\s*=\s*42/.test(t), {
            label: 'goal `foo = 42` rendered',
            timeout: 2 * 60_000,
        })

        await withInfoView(async () => {
            const fooSpan = await browser.$("//span[normalize-space(text())='foo']")
            await fooSpan.waitForExist({ timeout: 10_000 })

            // Ctrl-click triggers the InfoView's go-to-definition handler.
            await browser.performActions([
                {
                    type: 'key',
                    id: 'keyboard',
                    actions: [{ type: 'keyDown', value: '\uE009' }], // Control
                },
            ])
            await fooSpan.click()
            await browser.performActions([
                {
                    type: 'key',
                    id: 'keyboard',
                    actions: [{ type: 'keyUp', value: '\uE009' }],
                },
            ])
        })

        // The editor is in the main document, not the webview. Poll the active
        // editor's selection via the VS Code API until it lands on the `def`
        // line. Go-to-definition is handled by the language server, so allow a
        // few seconds.
        await browser.waitUntil(
            async () => {
                const line = await browser.executeWorkbench(async vscode => {
                    const editor = vscode.window.activeTextEditor
                    return editor ? editor.selection.active.line : -1
                })
                return line === 3
            },
            {
                timeout: 30_000,
                interval: 500,
                timeoutMsg: 'expected editor cursor to land on `def foo` (line 3)',
            },
        )
    })
})
