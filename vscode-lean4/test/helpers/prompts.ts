import * as sinon from 'sinon'
import { window } from 'vscode'
import { pollFor } from './timeouts'

export type Answer = string | RegExp | ((message: string, items: string[]) => string | undefined)

export interface PromptLog {
    kind: 'info' | 'warn' | 'error'
    message: string
    items: string[]
    chose: string | undefined
}

export interface CaptureOptions {
    /** When true, prompts that fire after the answer queue is empty resolve as
     * dismissed (the X-button outcome) instead of throwing. Default false: an
     * unaccounted prompt fails the test loudly so a regression that adds a new
     * notification is surfaced rather than silently swallowed. Use this for
     * flows that surface incidental info notifications the test doesn't care
     * about — being explicit at the call site makes the intent obvious. */
    dismissRemaining?: boolean
}

// Intercepts window.show{Information,Warning,Error}Message and returns scripted
// answers. Every interaction is logged to stdout so CI output reads like a
// transcript. By default, an unanswered prompt throws; pass `dismissRemaining`
// to opt into the older "dismiss whatever isn't scripted" behavior.
export function capturePrompts(
    answers: Answer[] = [],
    options: CaptureOptions = {},
): { log: PromptLog[]; restore: () => void } {
    const { dismissRemaining = false } = options
    const log: PromptLog[] = []
    const queue = [...answers]

    const apply = (answer: Answer | undefined, message: string, items: string[]): string | undefined => {
        if (typeof answer === 'function') return answer(message, items)
        if (answer instanceof RegExp) return items.find(i => answer.test(i))
        if (typeof answer === 'string') return answer
        return undefined
    }

    const resolve = (kind: PromptLog['kind'], message: string, rest: unknown[]) => {
        // Callers pass either `showXMessage(msg, ...strings)` (non-modal) or
        // `showXMessage(msg, options, ...MessageItems)` (modal). Flatten both:
        // MessageItems appear as objects with a `.title` field.
        const messageItems = rest.filter(
            (r): r is { title: string } =>
                typeof r === 'object' && r !== null && typeof (r as { title?: unknown }).title === 'string',
        )
        const stringItems = rest.filter((r): r is string => typeof r === 'string')
        const items: string[] = messageItems.length > 0 ? messageItems.map(m => m.title) : stringItems
        if (queue.length === 0 && !dismissRemaining) {
            throw new Error(
                `unexpected ${kind} prompt with no answer in queue: ${JSON.stringify(message)}` +
                    (items.length > 0 ? ` [${items.join(' | ')}]` : '') +
                    '; pass { dismissRemaining: true } if this is intentional',
            )
        }
        const next = queue.shift()
        const chose = apply(next, message, items)
        const entry: PromptLog = { kind, message, items, chose }
        log.push(entry)
        console.log(
            `[prompt ${kind}] ${JSON.stringify(message)} ` +
                `[${items.join(' | ')}] -> ${chose ?? '<dismissed>'}`,
        )
        if (chose !== undefined && messageItems.length > 0) {
            return Promise.resolve(messageItems.find(m => m.title === chose))
        }
        return Promise.resolve(chose)
    }

    const stubs = [
        sinon.stub(window, 'showInformationMessage').callsFake(((m: string, ...rest: unknown[]) =>
            resolve('info', m, rest)) as any),
        sinon.stub(window, 'showWarningMessage').callsFake(((m: string, ...rest: unknown[]) =>
            resolve('warn', m, rest)) as any),
        sinon.stub(window, 'showErrorMessage').callsFake(((m: string, ...rest: unknown[]) =>
            resolve('error', m, rest)) as any),
    ]

    return {
        log,
        restore: () => stubs.forEach(s => s.restore()),
    }
}

// Poll a capturePrompts() log until a prompt matching `predicate` appears, or
// `timeoutMs` elapses. The failure message includes every captured prompt so
// you can tell at a glance whether the prompt never fired, fired with the
// wrong content, or fired after the deadline.
export async function waitForPrompt(
    log: PromptLog[],
    predicate: (entry: PromptLog) => boolean,
    timeoutMs: number,
    label: string,
): Promise<PromptLog> {
    return pollFor(
        () => log.find(predicate),
        timeoutMs,
        () =>
            `prompt (${label}); captured prompts:\n` +
            log.map(p => `  [${p.kind}] ${p.message}`).join('\n'),
    )
}

// `capturePrompts` with an automatic `restore()` in `finally`, so tests don't
// have to write the try/finally themselves. The body receives the capture
// handle; whatever it returns is forwarded as the call's result.
export async function withPrompts<T>(
    answers: Answer[],
    body: (capture: { log: PromptLog[] }) => Promise<T>,
    options: CaptureOptions = {},
): Promise<T> {
    const capture = capturePrompts(answers, options)
    try {
        return await body(capture)
    } finally {
        capture.restore()
    }
}

export interface PromptExpectation {
    kind?: PromptLog['kind']
    messagePattern: RegExp
    // When set, the matching prompt must have resolved to this exact button
    // label. Use `dismissed: true` to require the prompt was dismissed (no
    // button picked). The two are mutually exclusive — splitting them avoids
    // the `'chose' in expected` footgun where a spread of `{ chose: undefined }`
    // would silently mean "must be dismissed" when the caller intended
    // "no constraint."
    chose?: string
    dismissed?: true
}

// Assert that at least one entry in `log` matches every field of `expected`.
// Failure dumps the full prompt log so the assertion message points at what
// actually fired. Strict (does not poll): run after awaiting the command that
// was expected to surface the prompt.
export function assertPromptFired(
    log: PromptLog[],
    expected: PromptExpectation,
    label?: string,
): PromptLog {
    if (expected.chose !== undefined && expected.dismissed) {
        throw new Error(
            'assertPromptFired: pass either `chose` or `dismissed: true`, not both',
        )
    }
    const match = log.find(p => {
        if (expected.kind !== undefined && p.kind !== expected.kind) return false
        if (!expected.messagePattern.test(p.message)) return false
        if (expected.chose !== undefined && p.chose !== expected.chose) return false
        if (expected.dismissed && p.chose !== undefined) return false
        return true
    })
    if (match !== undefined) return match
    const choseDesc = expected.chose !== undefined
        ? ` chose=${JSON.stringify(expected.chose)}`
        : expected.dismissed
        ? ' dismissed'
        : ''
    const desc = (expected.kind ? `[${expected.kind}] ` : '') + expected.messagePattern + choseDesc
    const captured = log.length === 0 ? '<none>' : log.map(p => `  [${p.kind}] ${p.message}`).join('\n')
    throw new Error(`expected prompt ${desc}${label ? ` (${label})` : ''}; captured:\n${captured}`)
}
