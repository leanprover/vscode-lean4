import { Diagnostic, DiagnosticSeverity, Uri, languages } from 'vscode'

// Subscribes to `onDidChangeDiagnostics` for `uri` BEFORE running `action`,
// then resolves once a post-action change satisfies `predicate`. Logs the
// count on every diagnostics change so CI transcripts show the server coming
// to life.
//
// Use this only for actions that **genuinely change LSP state** — restart
// commands, edits that trigger re-elaboration, etc. — and the test wants to
// verify the action caused the state change. A no-op restart (or any action
// that doesn't actually fire a diagnostic-change event) will cause this
// helper to time out, which is the desired regression-detector behaviour.
//
// Do NOT use this for "open this fixture and observe its diagnostics" cases
// where the URI may already be open in `workspace.textDocuments` from an
// earlier test. `workspace.openTextDocument(uri)` is idempotent for an
// already-open doc — it returns the existing TextDocument with no
// `onDidOpenTextDocument` event, so the LSP middleware sees nothing to
// forward and no fresh diagnostic-change event ever fires. Use
// `waitForDiagnostics` (with its leftover-tolerant short-circuit) instead;
// the leftover diagnostic IS the steady state you're trying to observe.
//
// Diagnostic-change events that fire DURING `action` are captured (the
// subscription is in place before the action starts). If `action` rejects,
// the helper rejects with the same error.
export async function waitForDiagnosticsAfter(
    uri: Uri,
    action: () => Thenable<unknown>,
    predicate: (d: Diagnostic[]) => boolean,
    timeoutMs: number,
    label = 'diagnostics',
): Promise<Diagnostic[]> {
    return new Promise((resolve, reject) => {
        const sub = languages.onDidChangeDiagnostics(e => {
            if (!e.uris.some(u => u.toString() === uri.toString())) return
            const diags = languages.getDiagnostics(uri)
            console.log(
                `[${label}] ${uri.fsPath}: ${diags.length} diagnostic(s)` +
                    (diags.length
                        ? ' — ' +
                          diags.map(d => `${DiagnosticSeverity[d.severity]}: ${d.message.split('\n')[0]}`).join('; ')
                        : ''),
            )
            if (predicate(diags)) {
                sub.dispose()
                clearTimeout(timer)
                resolve(diags)
            }
        })
        const timer = setTimeout(() => {
            sub.dispose()
            reject(
                new Error(
                    `[${label}] timed out after ${timeoutMs}ms waiting for diagnostics on ${uri.fsPath}. ` +
                        `Latest: ${JSON.stringify(languages.getDiagnostics(uri).map(d => d.message))}`,
                ),
            )
        }, timeoutMs)
        // `Promise.resolve(action())` evaluates `action()` synchronously, so
        // a sync throw (e.g. a TypeError before action returns a Thenable)
        // escapes before `.catch(...)` is wired up. The Promise constructor
        // would still auto-reject the outer promise, but `sub` and `timer`
        // would both leak. `.then(action)` defers the call to a microtask
        // and captures sync throws as rejections in the same chain.
        Promise.resolve()
            .then(action)
            .catch(err => {
                sub.dispose()
                clearTimeout(timer)
                reject(err)
            })
    })
}

// Resolves once `predicate` holds for the latest diagnostics on `uri`, or
// rejects on timeout. Short-circuits if the initial state already matches.
// Use for "open this fixture and observe its diagnostics" cases — the
// short-circuit correctly inherits leftover state from prior tests that
// opened the same URI, which IS the steady state we want to see.
//
// For actions that genuinely change LSP state (restart commands, etc.), use
// `waitForDiagnosticsAfter` instead — its post-action-fire requirement
// surfaces no-op restart regressions that this helper would silently
// short-circuit past.
export function waitForDiagnostics(
    uri: Uri,
    predicate: (d: Diagnostic[]) => boolean,
    timeoutMs: number,
    label = 'diagnostics',
): Promise<Diagnostic[]> {
    const initial = languages.getDiagnostics(uri)
    if (predicate(initial)) return Promise.resolve(initial)
    // No initial match — fall through to the event-driven wait by passing
    // a no-op `action`. The subscription has already gone in by the time
    // `Promise.resolve()` settles, so we'll catch any subsequent fires.
    return waitForDiagnosticsAfter(uri, () => Promise.resolve(), predicate, timeoutMs, label)
}

export const hasError = (diags: Diagnostic[]) =>
    diags.some(d => d.severity === DiagnosticSeverity.Error)

// Predicate factory: matches when at least one info-level diagnostic carries
// `text` in its message. Useful for asserting `#eval` output, which Lean
// publishes as Information-severity diagnostics on the `#eval` line.
export const hasInfoIncluding = (text: string) => (diags: Diagnostic[]) =>
    diags.some(d => d.severity === DiagnosticSeverity.Information && d.message.includes(text))
