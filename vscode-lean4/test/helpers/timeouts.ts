// Timeouts for the integration tests. They assume that the toolchain is
// installed (`scripts/testHome.mjs` installs it before the tests start). The
// network tests have their own, longer timeouts.

// For diagnostics after a file opens or the server restarts.
export const DIAGS_TIMEOUT_MS = 60_000
export const RESTART_DIAGS_TIMEOUT_MS = 60_000

// For an edit of the abbreviation rewriter. It normally takes some milliseconds.
export const ABBREVIATION_TIMEOUT_MS = 3000

// For a Lean client to start (`openAndAwaitClient`).
export const CLIENT_READY_MS = 60_000

// Polls `fn()` every 200 ms until it returns a value other than `undefined`,
// and returns that value. Fails after `timeoutMs`. A function `label` is
// called only on failure, so it can describe the last observed state.
export async function pollFor<T>(
    fn: () => T | undefined | Promise<T | undefined>,
    timeoutMs: number,
    label: string | (() => string),
): Promise<T> {
    const deadline = Date.now() + timeoutMs
    const error = () => timeoutError(timeoutMs, label)
    for (;;) {
        // A call of `fn()` that does not end fails at the deadline. Its error
        // gives `timeoutMs`, and not the time that was left for the call.
        const v = await rejectAfter(Promise.resolve(fn()), Math.max(deadline - Date.now(), 0), error)
        if (v !== undefined) return v
        if (Date.now() >= deadline) break
        await new Promise(r => setTimeout(r, Math.min(200, Math.max(deadline - Date.now(), 0))))
    }
    throw error()
}

// Waits for `promise`, but fails after `timeoutMs`.
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string | (() => string)): Promise<T> {
    return rejectAfter(promise, timeoutMs, () => timeoutError(timeoutMs, label))
}

function timeoutError(timeoutMs: number, label: string | (() => string)): Error {
    const labelStr = typeof label === 'function' ? label() : label
    return new Error(`timed out after ${timeoutMs}ms waiting for ${labelStr}`)
}

// Waits for `promise`, but rejects with `error()` after `ms`.
async function rejectAfter<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(error()), ms)
    })
    try {
        return await Promise.race([promise, timeout])
    } finally {
        clearTimeout(timer)
    }
}
