import * as fs from 'node:fs'

// Drop-in replacement for `fs.rmSync` with `recursive: true, force: true,
// maxRetries: 10, retryDelay: 100` baked in. Callers can override any field
// via the optional `options` arg.
//
// The retry policy exists to paper over Windows file-locking races. After
// the test runner just executed a binary (e.g. the runtime-compiled
// `lean.exe` mock toolchain stub, or `lean.exe` / `lake.exe` from a real
// toolchain), Windows briefly keeps the executable's PE image handle open
// while the loader tears down — and Defender's real-time scan adds another
// opportunistic lock when the file is freshly written. `fs.rmSync` then
// trips on `EPERM: operation not permitted, unlink '…\bin\lean.exe'`.
// `maxRetries: 10, retryDelay: 100` gives the OS up to ~5.5s of linear
// backoff (100ms, 200ms, 300ms…) to release; the first or second retry
// usually succeeds. POSIX is unaffected — no PE loader, no Defender —
// retries cost nothing because they don't fire.
//
// Use this from any test code that wipes a directory or file shortly
// after running a binary out of it. The matching Node imports in
// `scripts/*.mjs` (which can't import .ts helpers) duplicate the option
// blob inline; that's intentional.
export function rmSync(target: string, options?: fs.RmOptions): void {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100, ...options })
}
