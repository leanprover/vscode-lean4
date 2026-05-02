import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliTestNames } from './cliTestNames.mjs'
import { setupTestHome } from './testHome.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Spawns `vscode-test --label cli-<name>` once per test file in
// `test/vscode-test-cli/`. Each invocation runs in its own VS Code Electron —
// see `.vscode-test.mjs` for the per-file isolation rationale. We split into
// per-label invocations (instead of passing all `--label` flags to one
// `vscode-test`) so this script gets a per-label exit code and can print a
// summary of which labels passed / failed at the end. Without that, mocha's
// per-label "X passing" line for the LAST label is the only thing visible at
// the bottom of the terminal scrollback, and an earlier failure scrolls off.
//
// The trade-offs from splitting:
//   - Each child re-imports `.vscode-test.mjs`, which calls `setupTestHome()`
//     at module load. To avoid mkdtemp'ing a fresh test home per label (and
//     re-running `elan default` for each), we run `setupTestHome()` ONCE here
//     and pass the resulting dir to children via `LEAN4_TEST_HOME_OVERRIDE`
//     — `testHome.mjs` already respects that env var as its CI-cache hook.
//   - `.vscode-test.mjs` wipes `vscode-test-cli-output/` at module load.
//     Wiping per child would clobber dumps from earlier labels in the same
//     run, so we wipe it once here and set `LEAN4_TEST_OUTPUT_WIPED=1` so
//     children skip the wipe.

const cliOutputDir = path.resolve(__dirname, '..', 'vscode-test-cli-output')
fs.rmSync(cliOutputDir, { recursive: true, force: true })
fs.mkdirSync(cliOutputDir, { recursive: true })
process.env.LEAN4_TEST_OUTPUT_WIPED = '1'

const { testHome } = setupTestHome()
process.env.LEAN4_TEST_HOME_OVERRIDE = testHome

// Run each label in its own `vscode-test`, streaming output as it happens
// AND buffering it so we can re-emit the failure section of any failed label
// at the bottom of the terminal — mocha prints the failure detail at the
// end of each label's run, but with 9 labels' output stacked, that detail
// scrolls off-screen long before the summary appears. Reprinting it after
// the summary keeps it visible without forcing the user to scroll.
function runLabel(label) {
    return new Promise(resolve => {
        const t0 = Date.now()
        const child = spawn('vscode-test', ['--label', label], { shell: true })
        let captured = ''
        child.stdout.on('data', chunk => {
            process.stdout.write(chunk)
            captured += chunk.toString()
        })
        child.stderr.on('data', chunk => {
            process.stderr.write(chunk)
            captured += chunk.toString()
        })
        child.on('exit', code => {
            resolve({ label, status: code ?? 1, elapsedMs: Date.now() - t0, captured })
        })
    })
}

const results = []
for (const name of cliTestNames) {
    results.push(await runLabel(`cli-${name}`))
}

// Mocha's spec reporter ends each suite with `  N passing (Xs)\n  M failing\n\n  1) <suite>\n       <test>:\n     <error>\n     <stack>`.
// For a failed label, we want the "M failing"-onwards section. If the run
// crashed before mocha even reached its summary (extension host crash,
// before-hook failure), fall back to the tail of the captured output.
//
// Two pitfalls:
//   1. ANSI color escapes — mocha colors the summary lines, and with a TTY
//      or `FORCE_COLOR=1` the captured stream contains escapes between the
//      leading whitespace and the digit, so a `^\s+\d+` anchor never matches.
//   2. A stack-trace line that happens to contain `\d+ failing` (e.g. an
//      assertion message that quotes mocha output) — searching only for
//      `failing` would slice from there. Mocha's summary always emits
//      `\d+ passing` immediately before `\d+ failing`; require both, in
//      that order, to anchor to the real summary.
const ANSI_ESCAPE = /\x1b\[[\d;]*[A-Za-z]/g
function extractFailureDetail(captured) {
    const lines = captured.replace(ANSI_ESCAPE, '').split('\n')
    const passingIdx = lines.findIndex(line => /^\s+\d+ passing\b/.test(line))
    if (passingIdx >= 0) {
        const failingIdx = lines.findIndex(
            (line, i) => i > passingIdx && /^\s+\d+ failing\s*$/.test(line),
        )
        if (failingIdx >= 0) return lines.slice(failingIdx).join('\n').trim()
    }
    // Crash before mocha summary — show the last 50 lines so the actual
    // error (uncaught exception, before-hook stack, etc.) is visible.
    return lines.slice(-50).join('\n').trim()
}

const labelWidth = Math.max(...results.map(r => r.label.length))
const failed = results.filter(r => r.status !== 0)

console.log('')
console.log('─'.repeat(40))
console.log('vscode-test-cli summary')
console.log('─'.repeat(40))
for (const r of results) {
    const mark = r.status === 0 ? '✔' : '✘'
    const time = `${(r.elapsedMs / 1000).toFixed(1)}s`
    const status = r.status === 0 ? '' : `  (exit ${r.status})`
    console.log(`  ${mark} ${r.label.padEnd(labelWidth)}  ${time}${status}`)
}
console.log('')
console.log(`  ${results.length - failed.length}/${results.length} labels passed`)
if (failed.length > 0) {
    console.log(`  failed: ${failed.map(f => f.label).join(', ')}`)
}
console.log('')

for (const r of failed) {
    console.log('─'.repeat(40))
    console.log(`failure detail: ${r.label}`)
    console.log('─'.repeat(40))
    console.log(extractFailureDetail(r.captured))
    console.log('')
}

process.exit(failed.length > 0 ? 1 : 0)
