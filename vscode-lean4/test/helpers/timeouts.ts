// Shared timeouts for integration tests. Centralized so when CDN latency or
// toolchain download size shifts, every suite moves together rather than
// drifting out of sync.

// Budget for the first diagnostics publish after launching a server. On a
// fresh ELAN_HOME this pays for downloading and extracting the toolchain, so
// ten minutes is the floor, not the expected case.
export const FIRST_DIAGS_TIMEOUT_MS = 10 * 60_000

// Budget for a subsequent diagnostics publish in an already-warm environment
// — typically a second `lake serve` spawn for a new project after the first
// has cold-started (toolchain installed). 60s is generous CI tolerance; if a
// second serve genuinely needs longer than this something is broken and we'd
// rather see a fast failure than wait it out.
export const DIAGS_TIMEOUT_MS = 60_000

// Budget after `restartServer` / `restartFile` in a warm environment. Same
// shape as `DIAGS_TIMEOUT_MS`: 60s is generous CI tolerance; a longer budget
// would just slow down failure detection.
export const RESTART_DIAGS_TIMEOUT_MS = 60_000

// Budget for a local text-document change to settle (typing → abbreviation
// rewriter → replacement edit). Local-only — no network / server. The 3s
// floor covers CI under load; nothing here should normally take more than a
// few hundred ms.
export const ABBREVIATION_TIMEOUT_MS = 3000

// Budget for `waitForActiveClient` on first-run: sized to cover toolchain
// install the same way as `FIRST_DIAGS_TIMEOUT_MS`.
export const CLIENT_READY_MS = FIRST_DIAGS_TIMEOUT_MS

// Polls `fn()` every 200ms until it returns something other than `undefined`,
// or `timeoutMs` elapses (in which case throws mentioning `label`). The
// returned value is whatever `fn()` produced. Use when you need the value of
// the awaited state (e.g. "the new LeanClient after a restart"); for plain
// boolean predicates return `true | undefined` from `fn`.
//
// `label` accepts a function form for callers that want to include
// observed-state in the timeout message (e.g. a captured-prompt dump). The
// function is only invoked on timeout, so the message can be expensive.
export async function pollFor<T>(
    fn: () => T | undefined | Promise<T | undefined>,
    timeoutMs: number,
    label: string | (() => string),
): Promise<T> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const v = await fn()
        if (v !== undefined) return v
        await new Promise(r => setTimeout(r, 200))
    }
    const labelStr = typeof label === 'function' ? label() : label
    throw new Error(`timed out after ${timeoutMs}ms waiting for ${labelStr}`)
}
