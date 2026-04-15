// Shared timeouts for integration tests. Centralized so when CDN latency or
// `lake serve` startup time shifts, every suite moves together rather than
// drifting out of sync.
//
// The default-suite assumption is a *warm* environment: the toolchain is
// already installed (CI's `setup-elan` composite pre-installs it; local
// runs assume a developer-installed elan). Tests that explicitly exercise
// install / mathlib-fetch flows live under `test/network/` and define
// their own longer budgets locally — the constants here intentionally do
// not cover toolchain download.

// Budget for a diagnostics publish in a warm environment. 60s is generous
// CI tolerance; if a serve genuinely needs longer than this something is
// broken and we'd rather see a fast failure than wait it out.
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

// Budget for `waitForActiveClient` in a warm environment — covers LSP
// client attach + `lake serve` spawn. 60s is generous CI tolerance.
export const CLIENT_READY_MS = 60_000

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
