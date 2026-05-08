import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { DiagnosticSeverity, Uri, extensions, languages } from 'vscode'
import { closeAllEditors, openInEditor } from '../helpers/editors'
import { FIXTURES as FIXTURES_ROOT } from '../helpers/fixtures'
import { afterEachReset } from '../helpers/teardown'
import { makeTestWorkDir } from '../helpers/testHome'
import { pollFor } from '../helpers/timeouts'

// `tamasfe.even-better-toml` is configured (via this extension's
// `contributes.tomlValidation`) to validate any file named `lakefile.toml`
// against the Lake schema. These tests verify that the schema accepts a
// representative set of valid lakefiles and rejects a representative set of
// invalid ones.
//
// The schema is fetched from a GitHub URL on first use, so tests need
// network access and the first `it` pays a schema-fetch cost.

const FIXTURES = path.join(FIXTURES_ROOT, 'lakefile-toml-schema')

async function openLakefile(dir: string, src: string): Promise<Uri> {
    fs.mkdirSync(dir, { recursive: true })
    const dst = path.join(dir, 'lakefile.toml')
    fs.copyFileSync(src, dst)
    const uri = Uri.file(dst)
    await openInEditor(uri)
    return uri
}

// Polls `vscode.languages.getDiagnostics` until `predicate(errorCount)` is
// true or `timeout` elapses. Even Better TOML publishes schema diagnostics
// asynchronously after the document becomes visible.
async function waitForTomlErrorCount(
    uri: Uri,
    predicate: (errors: number) => boolean,
    { label, timeout }: { label: string; timeout: number },
): Promise<number> {
    const errorCount = () =>
        languages
            .getDiagnostics(uri)
            .filter(d => d.severity === DiagnosticSeverity.Error && d.source === 'Even Better TOML').length
    return pollFor(
        () => {
            const count = errorCount()
            return predicate(count) ? count : undefined
        },
        timeout,
        () => `${label} (last error count: ${errorCount()})`,
    )
}

const validDir = path.join(FIXTURES, 'valid')
const invalidDir = path.join(FIXTURES, 'invalid')

// Read fixture lists at module load. If a directory is empty (or missing),
// the dynamic `for (const fixtureName of …)` loops below would silently
// produce zero `it` blocks and the suite would report green with no tests.
// Fail loudly here instead.
const validFixtures = fs.readdirSync(validDir)
const invalidFixtures = fs.readdirSync(invalidDir)
assert.ok(
    validFixtures.length > 0,
    `expected at least one fixture under ${validDir}; got an empty directory`,
)
assert.ok(
    invalidFixtures.length > 0,
    `expected at least one fixture under ${invalidDir}; got an empty directory`,
)

describe('lakefile.toml schema validation', function () {
    this.timeout(60_000)

    let workRoot: string

    before(async function () {
        workRoot = makeTestWorkDir('lean4-lakefile-schema-')

        // Confirm Even Better TOML is installed and active. Without it, the
        // schema is never applied: every `valid/` fixture would pass trivially
        // (no diagnostics at all) and every `invalid/` fixture would fail with
        // an unhelpful "no diagnostics within budget" timeout from the probe.
        // `.vscode-test.mjs` relies on @vscode/test-electron auto-installing
        // `extensionDependencies` into ~/.vscode-test/extensions; if that ever
        // breaks, the assertion below points straight at the cause.
        const ext = extensions.getExtension('tamasfe.even-better-toml')
        assert.ok(
            ext,
            'tamasfe.even-better-toml is not installed in the test extension host — ' +
                'check `extensionDependencies` resolution in @vscode/test-electron.',
        )
        if (!ext.isActive) {
            await ext.activate()
        }
        assert.ok(ext.isActive, 'tamasfe.even-better-toml is installed but failed to activate')

        // Probe that the schema actually loaded. If the GitHub fetch fails
        // (offline runner, DNS, schema URL changed), Even Better TOML publishes
        // no diagnostics at all — and every `valid/` fixture would then pass
        // trivially with zero errors. Open a known-invalid fixture first and
        // refuse to proceed unless it produces at least one schema diagnostic.
        this.timeout(2 * 60_000)
        const probeFixture = invalidFixtures[0]
        const probeUri = await openLakefile(path.join(workRoot, 'schema-probe'), path.join(invalidDir, probeFixture))
        try {
            await waitForTomlErrorCount(probeUri, n => n > 0, {
                label:
                    `schema probe: no Even Better TOML diagnostics on invalid/${probeFixture} within the budget — ` +
                    'the Lake schema likely failed to load (offline runner? schema URL moved?)',
                timeout: 90_000,
            })
            // Sanity check: if `d.source === 'Even Better TOML'` is ever renamed,
            // every test in this suite still passes its `== 0`/`> 0` predicate
            // because the filter drops all diagnostics. Confirm the invalid
            // fixture produces at least one diagnostic without the source
            // filter; otherwise the whole suite is vacuous.
            const unfilteredErrors = languages
                .getDiagnostics(probeUri)
                .filter(d => d.severity === DiagnosticSeverity.Error).length
            assert.ok(
                unfilteredErrors > 0,
                `schema probe produced zero error diagnostics of any source on invalid/${probeFixture}; ` +
                    'either the fixture no longer violates the schema, or the Even Better TOML source ' +
                    "string changed — update waitForTomlErrorCount's `d.source` filter.",
            )
        } finally {
            await closeAllEditors()
        }
    })

    afterEach(afterEachReset)

    for (const fixtureName of validFixtures) {
        it(`accepts valid/${fixtureName}`, async () => {
            const dir = path.join(workRoot, `valid-${fixtureName}`)
            const uri = await openLakefile(dir, path.join(validDir, fixtureName))
            // First fixture may fetch the remote schema — give it extra time.
            const errors = await waitForTomlErrorCount(uri, n => n === 0, {
                label: `expected 0 Even Better TOML errors for valid/${fixtureName}`,
                timeout: 60_000,
            })
            assert.strictEqual(errors, 0)
        })
    }

    for (const fixtureName of invalidFixtures) {
        it(`rejects invalid/${fixtureName}`, async () => {
            const dir = path.join(workRoot, `invalid-${fixtureName}`)
            const uri = await openLakefile(dir, path.join(invalidDir, fixtureName))
            const errors = await waitForTomlErrorCount(uri, n => n > 0, {
                label: `expected ≥1 Even Better TOML error for invalid/${fixtureName}`,
                timeout: 60_000,
            })
            assert.ok(errors > 0)
        })
    }
})
