import * as assert from 'node:assert'
import * as sinon from 'sinon'
import { QuickPick, QuickPickItem, QuickPickOptions, window } from 'vscode'

// `lean4.setup.selectDefaultToolchain` and similar pickers list every Lean
// version ever released — hundreds of items. Logging the full list shoves
// the actual test failure off the top of the terminal scrollback. The full
// list is still kept in the structured `log[]` entry for assertions; only
// the human-readable console line is clipped.
const LOG_HEAD_ITEMS = 5
const LOG_TAIL_ITEMS = 2
function formatLabelsForLog(labels: string[]): string {
    if (labels.length <= LOG_HEAD_ITEMS + LOG_TAIL_ITEMS + 1) {
        return `[${labels.join(' | ')}]`
    }
    const head = labels.slice(0, LOG_HEAD_ITEMS).join(' | ')
    const tail = labels.slice(-LOG_TAIL_ITEMS).join(' | ')
    const elided = labels.length - LOG_HEAD_ITEMS - LOG_TAIL_ITEMS
    return `[${head} | … (${elided} more) … | ${tail}]`
}

export interface QuickPickLog {
    title: string | undefined
    items: string[]
    chose: string | string[] | undefined
}

export type QuickPickAnswer =
    | string
    | RegExp
    | ((items: QuickPickItem[], options: QuickPickOptions | undefined) => QuickPickItem | QuickPickItem[] | undefined)

export interface CaptureQuickPicksOptions {
    /** When true, quick-picks that fire after the answer queue is empty resolve
     * as dismissed instead of throwing. Default false: an unaccounted pick
     * fails the test loudly so a regression that adds a new picker is
     * surfaced. Mirrors `prompts.ts` `dismissRemaining`. */
    dismissRemaining?: boolean
}

// Intercepts `window.showQuickPick` and returns scripted answers. Strings and
// RegExps match against `QuickPickItem.label`. `canPickMany` picks always
// receive an array (possibly empty). Supports both VS Code overloads:
// `showQuickPick(string[], ...)` and `showQuickPick(QuickPickItem[], ...)`.
// By default, an unanswered pick throws; pass `dismissRemaining` to opt into
// the older "dismiss whatever isn't scripted" behavior.
export function captureQuickPicks(
    answers: QuickPickAnswer[] = [],
    options: CaptureQuickPicksOptions = {},
): {
    log: QuickPickLog[]
    restore: () => void
} {
    const { dismissRemaining = false } = options
    const log: QuickPickLog[] = []
    const queue = [...answers]

    const stub = sinon.stub(window, 'showQuickPick').callsFake((async (
        itemsOrThenable: any,
        pickOptions?: any,
    ) => {
        const rawItems: (QuickPickItem | string)[] = (await itemsOrThenable) as (QuickPickItem | string)[]
        // VS Code's string overload: each item is a bare label. Normalize
        // once so the rest of the stub only deals with QuickPickItem shape,
        // then convert the chosen item(s) back to strings before returning.
        const stringOverload = rawItems.length > 0 && typeof rawItems[0] === 'string'
        const items: QuickPickItem[] = stringOverload
            ? (rawItems as string[]).map(label => ({ label }))
            : (rawItems as QuickPickItem[])
        const labels = items.map(i => i.label)
        if (queue.length === 0 && !dismissRemaining) {
            throw new Error(
                `unexpected quick-pick with no answer in queue: ${JSON.stringify(pickOptions?.title ?? '')}` +
                    (labels.length > 0 ? ` [${labels.join(' | ')}]` : '') +
                    '; pass { dismissRemaining: true } if this is intentional',
            )
        }
        const next = queue.shift()

        let chosenItems: QuickPickItem | QuickPickItem[] | undefined
        if (typeof next === 'function') chosenItems = next(items, pickOptions)
        else if (next instanceof RegExp) {
            // Multi-pick: pick every label matching the regex. Single-pick:
            // first match. Without this, a regex answer to a multi-pick would
            // wrap the first match in a one-element array (via the
            // canPickMany guard below), almost certainly the wrong intent.
            chosenItems = pickOptions?.canPickMany
                ? items.filter(i => next.test(i.label))
                : items.find(i => next.test(i.label))
        } else if (typeof next === 'string') chosenItems = items.find(i => i.label === next)

        if (pickOptions?.canPickMany && chosenItems !== undefined && !Array.isArray(chosenItems)) {
            chosenItems = [chosenItems]
        }
        // Symmetric guard: a function answer can legally return an array
        // (the type allows it), but VS Code's `showQuickPick` returns a single
        // value when `canPickMany` is false. Returning the array would type-
        // launder through `as any` and surface later as a runtime error in
        // production code that assumed a string/QuickPickItem. Throw with a
        // clear message instead so the test author sees the mismatch.
        if (!pickOptions?.canPickMany && Array.isArray(chosenItems)) {
            throw new Error(
                `quick-pick answer returned an array of ${chosenItems.length} items, but canPickMany is false ` +
                    `(single-value pick): ${JSON.stringify(chosenItems.map(i => i.label))}`,
            )
        }

        const chose = Array.isArray(chosenItems)
            ? chosenItems.map(i => i.label)
            : chosenItems?.label
        log.push({ title: pickOptions?.title, items: labels, chose })
        console.log(
            `[quickPick] ${JSON.stringify(pickOptions?.title ?? '')} ` +
                `${formatLabelsForLog(labels)} -> ${
                    Array.isArray(chose) ? `[${chose.join(' | ')}]` : (chose ?? '<dismissed>')
                }`,
        )
        if (stringOverload) {
            return Array.isArray(chosenItems) ? chosenItems.map(i => i.label) : (chosenItems?.label as any)
        }
        return chosenItems as any
    }) as any)

    return { log, restore: () => stub.restore() }
}

// `captureQuickPicks` with an automatic `restore()` in `finally`. Mirrors the
// `withPrompts` shape in `./prompts.ts`.
export async function withQuickPicks<T>(
    answers: QuickPickAnswer[],
    body: (capture: { log: QuickPickLog[] }) => Promise<T>,
    options: CaptureQuickPicksOptions = {},
): Promise<T> {
    const capture = captureQuickPicks(answers, options)
    try {
        return await body(capture)
    } finally {
        capture.restore()
    }
}

// Stubs `window.createQuickPick` for code that uses the stateful API (as
// opposed to the one-shot `showQuickPick`). Returns a fake pick whose `show()`
// picks the first item matching `selectLabel`, fires `onDidChangeActive` and
// `onDidChangeSelection` for that item, and then runs every registered
// `onDidAccept` handler. The returned `accepted` promise resolves once all
// accept handlers settle, so tests can `await` it before making assertions.
//
// `onDidChangeValue`, `onDidHide`, `onDidTriggerButton`, and
// `onDidTriggerItemButton` collect handlers (so `dispose()` works) but are
// never fired automatically — the stub doesn't simulate user typing or
// hide/button gestures. If a future test needs them, extend this helper
// rather than forking a whole fake.
export function stubStatefulQuickPick(selectLabel: string): {
    stub: sinon.SinonStub
    accepted: Promise<void>
} {
    let resolveAccept: () => void
    let rejectAccept: (e: unknown) => void
    const accepted = new Promise<void>((res, rej) => {
        resolveAccept = res
        rejectAccept = rej
    })
    const register = <T>(list: ((arg: T) => any)[]) => (cb: (arg: T) => any) => {
        list.push(cb)
        return {
            dispose: () => {
                const idx = list.indexOf(cb)
                if (idx !== -1) list.splice(idx, 1)
            },
        }
    }
    const acceptCbs: (() => any)[] = []
    const selectionCbs: ((items: readonly QuickPickItem[]) => any)[] = []
    const activeCbs: ((items: readonly QuickPickItem[]) => any)[] = []
    const valueCbs: ((value: string) => any)[] = []
    const hideCbs: (() => any)[] = []
    const triggerButtonCbs: ((arg: any) => any)[] = []
    const triggerItemButtonCbs: ((arg: any) => any)[] = []
    const fakeQuickPick: any = {
        items: [] as readonly QuickPickItem[],
        selectedItems: [] as readonly QuickPickItem[],
        activeItems: [] as readonly QuickPickItem[],
        value: '',
        title: '',
        placeholder: '',
        ignoreFocusOut: false,
        matchOnDescription: false,
        matchOnDetail: false,
        onDidChangeValue: register(valueCbs),
        onDidAccept: register(acceptCbs),
        onDidHide: register(hideCbs),
        onDidChangeActive: register(activeCbs),
        onDidChangeSelection: register(selectionCbs),
        onDidTriggerButton: register(triggerButtonCbs),
        onDidTriggerItemButton: register(triggerItemButtonCbs),
        show() {
            // Defer the items-match step into the same microtask chain as the
            // event firings. Production code is allowed to set `qp.items =
            // [...]` after `qp.show()` (VS Code's real API doesn't validate
            // items in `show()`), so a synchronous match here would throw
            // out of `show()` before the items are populated. By the time
            // this `.then` runs, the synchronous portion of the calling
            // function has finished — including any post-`show()` items
            // assignment. A genuine no-match then rejects `accepted`
            // loudly via `rejectAccept` rather than escaping `show()`.
            // Fire change events first so accept handlers see the populated
            // selection — matches the real VS Code event order.
            Promise.resolve()
                .then(() => {
                    const match = fakeQuickPick.items.find((i: QuickPickItem) => i.label === selectLabel)
                    assert.ok(match, `expected a quick-pick item labeled ${JSON.stringify(selectLabel)}`)
                    const selection: readonly QuickPickItem[] = [match]
                    fakeQuickPick.activeItems = selection
                    fakeQuickPick.selectedItems = selection
                })
                .then(() => Promise.all(activeCbs.map(cb => cb(fakeQuickPick.activeItems))))
                .then(() => Promise.all(selectionCbs.map(cb => cb(fakeQuickPick.selectedItems))))
                .then(() => Promise.all(acceptCbs.map(cb => cb())))
                .then(resolveAccept, rejectAccept)
        },
        hide: () => {},
        dispose: () => {},
    }
    const stub = sinon
        .stub(window, 'createQuickPick')
        .returns(fakeQuickPick as unknown as QuickPick<QuickPickItem>)
    return { stub, accepted }
}
