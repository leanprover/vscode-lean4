import * as fs from 'node:fs'

// `fs.rmSync` with `recursive`, `force` and retries. On Windows, a file that
// a process just ran (for example `lean.exe`) stays locked for a short time,
// and deleting it fails with `EPERM`. The retries wait up to about 5 s.
// `scripts/*.mjs` cannot import this file, so they repeat the options.
export function rmSync(target: string, options?: fs.RmOptions): void {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100, ...options })
}
