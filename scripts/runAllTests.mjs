import { spawn } from 'node:child_process'

// Run every top-level test suite sequentially, capturing per-suite exit
// codes and CONTINUING past failures rather than `&&`-bailing on the
// first one. Mirrors the pattern in `vscode-lean4/scripts/runCliTests.mjs`,
// but at the suite (vitest / tsc / grammar / cli / wdio) level instead
// of the per-file `cli-*` label level.
//
// Why: the suites test largely orthogonal slices (pure-TS unit tests vs
// infoview type-check vs grammar snapshots vs extension-host integration
// vs UI). A vitest failure tells you nothing about whether the wdio side
// has also regressed, so stopping there hides downstream breakage and
// forces "fix one, push, discover the next" iteration on CI. Running all
// of them in one pass exposes the full picture.
//
// Each suite's `pretest:*` hook still fires (we invoke via `npm run`),
// so `build-for-tests` runs at the start of `vscode-test-cli` and again
// at the start of `wdio`. Both are incremental — the second invocation
// finds tsc and webpack outputs already up-to-date and exits in seconds.

function runSuite(suite) {
    return new Promise(resolve => {
        const t0 = Date.now()
        // `shell: true` so npm's `.cmd` shim resolves on Windows, same as
        // `vscode-lean4/scripts/headless.mjs`. The args list has no shell-
        // meaningful characters, so injection isn't a concern.
        const child = spawn(suite.cmd, suite.args, { stdio: 'inherit', shell: true })
        child.on('exit', code => {
            resolve({ name: suite.name, status: code ?? 1, elapsedMs: Date.now() - t0 })
        })
    })
}

const suites = [
    { name: 'unit (vitest)', cmd: 'npm', args: ['run', 'test:unit'] },
    { name: 'infoview (tsc)', cmd: 'npm', args: ['run', 'test', '--workspace=@leanprover/infoview'] },
    { name: 'grammar', cmd: 'npm', args: ['run', 'test:grammar', '--workspace=lean4'] },
    { name: 'vscode-test-cli', cmd: 'npm', args: ['run', 'test:vscode-test-cli', '--workspace=lean4'] },
    { name: 'wdio', cmd: 'npm', args: ['run', 'test:wdio', '--workspace=lean4'] },
]

const results = []
for (const suite of suites) {
    console.log('')
    console.log('═'.repeat(60))
    console.log(`▶ ${suite.name}`)
    console.log('═'.repeat(60))
    results.push(await runSuite(suite))
}

const labelWidth = Math.max(...results.map(r => r.name.length))
const failed = results.filter(r => r.status !== 0)

console.log('')
console.log('─'.repeat(40))
console.log('test suite summary')
console.log('─'.repeat(40))
for (const r of results) {
    const mark = r.status === 0 ? '✔' : '✘'
    const time = `${(r.elapsedMs / 1000).toFixed(1)}s`
    const status = r.status === 0 ? '' : `  (exit ${r.status})`
    console.log(`  ${mark} ${r.name.padEnd(labelWidth)}  ${time}${status}`)
}
console.log('')
console.log(`  ${results.length - failed.length}/${results.length} suites passed`)
if (failed.length > 0) {
    console.log(`  failed: ${failed.map(f => f.name).join(', ')}`)
}
console.log('')

process.exit(failed.length > 0 ? 1 : 0)
