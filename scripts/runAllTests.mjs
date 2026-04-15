import { exitLike, runChild, stoppedBy } from '../vscode-lean4/scripts/childProcess.mjs'
import { prepareTestHome } from '../vscode-lean4/scripts/testHome.mjs'

// Runs all test suites, also after a failure, so that one run shows all
// failures. Prints a summary at the end.
//
// The VS Code suites need the same build. Thus this script builds one time,
// and runs their npm scripts with `--ignore-scripts`, which skips the
// `pretest:*` builds. It also prepares the test home one time: the run scripts
// of the suites see `LEAN4_TEST_HOME` and do not reset it again.

async function runSuite(suite) {
    const t0 = Date.now()
    // On Windows, npm is a `.cmd` file, which needs a shell.
    const { status } = await runChild('npm', suite.args, { stdio: 'inherit', shell: process.platform === 'win32' })
    return { name: suite.name, status, elapsedMs: Date.now() - t0 }
}

const vscodeSuite = (name, script) => ({
    name,
    args: ['run', script, '--workspace=lean4', '--ignore-scripts'],
    needsBuild: true,
})

const suites = [
    { name: 'unit (vitest)', args: ['run', 'test:unit'] },
    // The `test` scripts of the packages type-check their tests.
    { name: 'type check (tsc)', args: ['run', 'test', '--workspaces', '--if-present'] },
    { name: 'grammar', args: ['run', 'test:grammar', '--workspace=lean4'] },
    { name: 'build for tests', args: ['run', 'build-for-tests', '--workspace=lean4'], isBuild: true },
    vscodeSuite('vscode-test-cli', 'test:vscode-test-cli'),
    vscodeSuite('wdio', 'test:wdio'),
]

const results = []
// Why the VS Code suites cannot run, if they cannot.
let vscodeSuitesBlocked
for (const suite of suites) {
    if (stoppedBy()) {
        results.push({ name: suite.name, status: 1, elapsedMs: 0, note: `not run: stopped by ${stoppedBy()}` })
        continue
    }
    if (suite.needsBuild && !vscodeSuitesBlocked && !process.env.LEAN4_TEST_HOME) {
        try {
            prepareTestHome()
        } catch (e) {
            console.error(`cannot prepare the test home: ${e instanceof Error ? e.message : e}`)
            vscodeSuitesBlocked = 'no test home'
        }
    }
    if (suite.needsBuild && vscodeSuitesBlocked) {
        results.push({ name: suite.name, status: 1, elapsedMs: 0, note: `not run: ${vscodeSuitesBlocked}` })
        continue
    }
    console.log('')
    console.log('═'.repeat(60))
    console.log(`▶ ${suite.name}`)
    console.log('═'.repeat(60))
    const result = await runSuite(suite)
    results.push(result)
    if (suite.isBuild && result.status !== 0) {
        vscodeSuitesBlocked = 'the build failed'
    }
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
    const status = r.note !== undefined ? `  (${r.note})` : r.status === 0 ? '' : `  (exit ${r.status})`
    console.log(`  ${mark} ${r.name.padEnd(labelWidth)}  ${time}${status}`)
}
console.log('')
console.log(`  ${results.length - failed.length}/${results.length} suites passed`)
if (failed.length > 0) {
    console.log(`  failed: ${failed.map(f => f.name).join(', ')}`)
}
console.log('')

exitLike({ status: failed.length > 0 ? 1 : 0, signal: null })
