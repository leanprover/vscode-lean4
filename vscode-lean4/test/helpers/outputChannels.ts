import * as sinon from 'sinon'
import { LogOutputChannel, OutputChannel, window } from 'vscode'

// Per-channel transcript of every write the extension does into a VS Code
// `OutputChannel`. Populated by `startOutputChannelCapture()` (called from
// `activateExtension`) and read by `helpers/teardown.ts` for the state dump.
const captured = new Map<string, string>()

let stub: sinon.SinonStub | undefined

function record(name: string, text: string): void {
    captured.set(name, (captured.get(name) ?? '') + text)
    // Mirror to the test runner's stdout so a `npm run test:nightly` session
    // shows what the extension is logging in real time, not just on dump
    // after a failure. Prefix with the channel name so a CI log can be
    // grepped/filtered later.
    const ensureTrailingNewline = text.endsWith('\n') ? '' : '\n'
    process.stdout.write(`[output:${name}] ${text}${ensureTrailingNewline}`)
}

// Wraps `vscode.window.createOutputChannel` so every channel the extension
// creates also (a) accumulates its writes in `captured` and (b) streams them
// to stdout. Idempotent — safe to call from every `activateExtension`. Must
// run before the extension calls `createOutputChannel` (the wrapper only
// affects future channels), so call this from `activateExtension` BEFORE
// `ext.activate()`.
//
// `LogOutputChannel` (vscode 1.74+) extends `OutputChannel` with `info` /
// `warn` / `debug` / `trace` / `error` writers; we wrap those too.
export function startOutputChannelCapture(): void {
    if (stub) return
    const orig = window.createOutputChannel.bind(window)
    // Type the fake's signature explicitly and cast to
    // `typeof window.createOutputChannel`. The previous `as never`
    // accepted *any* function shape; the typed cast at least requires
    // the parameters to be roughly compatible with the real overloads,
    // so a future @types/vscode bump that renames a parameter or shifts
    // the overload set surfaces here instead of silently passing through.
    const fake = ((name: string, optionsOrLanguage?: { readonly log: true } | string) => {
        const channel = (orig as (n: string, o?: unknown) => OutputChannel & Partial<LogOutputChannel>)(
            name,
            optionsOrLanguage,
        )
        if (!captured.has(name)) captured.set(name, '')

        const wrapWriter = (method: string, framing: (text: string) => string) => {
            const origMethod = (channel as unknown as Record<string, unknown>)[method]
            if (typeof origMethod !== 'function') return
            ;(channel as unknown as Record<string, unknown>)[method] = function (...callArgs: unknown[]) {
                const text = String(callArgs[0] ?? '')
                record(name, framing(text))
                return (origMethod as (...args: unknown[]) => unknown).apply(channel, callArgs)
            }
        }
        // Manual enumeration of writer methods on `OutputChannel` and
        // `LogOutputChannel`. If a future @types/vscode bump adds a new
        // writer (e.g. a hypothetical `notice` / `appendBytes`), the
        // `wrapWriter` runtime guard skips unknown methods silently —
        // which means the failure-state dump would lose that channel's
        // content for the new writer. Add any new writer to this list
        // when bumping `@types/vscode`.
        wrapWriter('append', t => t)
        wrapWriter('appendLine', t => t + '\n')
        wrapWriter('replace', t => `[replace]\n${t}\n`)
        // LogOutputChannel writers — these typically format their own line
        // and add a level prefix; we only need to record the user-supplied
        // payload so we don't double-prefix.
        wrapWriter('trace', t => `[trace] ${t}\n`)
        wrapWriter('debug', t => `[debug] ${t}\n`)
        wrapWriter('info', t => `[info] ${t}\n`)
        wrapWriter('warn', t => `[warn] ${t}\n`)
        wrapWriter('error', t => `[error] ${t}\n`)

        return channel
    }) as typeof window.createOutputChannel
    stub = sinon.stub(window, 'createOutputChannel').callsFake(fake)
}

// Snapshot of every channel's accumulated text since `startOutputChannelCapture`
// was first called. Buffers persist across tests in the same VS Code instance
// — a later test's dump therefore contains every prior test's transcript too.
// Acceptable trade-off: most failures want the full chain of events leading
// up to the break, and most suites run a small number of tests per host.
// Each `cli-*` label runs in its own VS Code instance, so this module reloads
// between files — buffers do not leak across test files.
export function getOutputChannelContents(): Record<string, string> {
    return Object.fromEntries(captured)
}
