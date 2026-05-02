import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Context } from 'mocha'
import { DiagnosticSeverity, languages, window, workspace } from 'vscode'
import { closeAllEditors } from './editors'
import { getOutputChannelContents } from './outputChannels'

// Single landing dir for vscode-test-cli failure dumps. The wipe lives in
// `.vscode-test.mjs` so it runs ONCE per `vscode-test` invocation — under the
// per-file `cli-*` label scheme each test file gets its own VS Code instance,
// so a module-load wipe here would clobber dumps from earlier files in the
// same run. We only ensure the dir exists (idempotent). `vscode-test-cli-output/`
// is gitignored. CI uploads it as an artifact alongside `wdio-output/`.
//
// The `../../../` hop count is implicitly tied to the compiled-test layout
// `<pkg>/out/test/helpers/teardown.js`. Assert the layout assumption
// directly so a future `out/` refactor (project references, flatter
// layout, etc.) fails loudly at module load instead of silently writing
// dumps to the wrong place. Anchoring on `__dirname`'s tail rather than
// on the resolved path's parent dodges a false negative in this repo
// specifically — the workspace root and the package dir are both named
// `vscode-lean4`, so a 1-level shallow miscount would otherwise still
// land at a path whose parent basename matched.
const EXPECTED_DIRNAME_SUFFIX = path.join('out', 'test', 'helpers')
assert.ok(
    __dirname.endsWith(EXPECTED_DIRNAME_SUFFIX),
    `teardown.ts loaded from ${__dirname}; expected a path ending in ${EXPECTED_DIRNAME_SUFFIX}. ` +
        'The OUTPUT_DIR `../../../` hop count below assumes that layout.',
)
const OUTPUT_DIR = path.resolve(__dirname, '../../../vscode-test-cli-output')
fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// On test failure, write a JSON snapshot of the workbench's textual state next
// to the test name. The snapshot covers everything a vscode-test-cli failure
// usually needs to debug — diagnostics for every URI, the active editor's
// contents and cursor, visible/open documents — but skips pixels (vscode-test-cli
// failures are diagnostic-/text-driven, not visual; the wdio suite already
// captures screenshots for the cases where pixels matter).
export async function dumpStateIfFailed(ctx: Context): Promise<void> {
    const test = ctx.currentTest
    if (!test || test.state !== 'failed') return

    const safe = `${test.parent?.title ?? ''} ${test.title}`
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
    const file = path.join(OUTPUT_DIR, `${safe}.json`)

    const allDiagnostics = languages.getDiagnostics().map(([uri, diags]) => ({
        uri: uri.toString(),
        diagnostics: diags.map(d => ({
            severity: DiagnosticSeverity[d.severity],
            message: d.message,
            range: [d.range.start, d.range.end],
            source: d.source,
        })),
    }))

    const active = window.activeTextEditor
    const dump = {
        test: {
            title: test.title,
            parent: test.parent?.title,
            error: test.err?.stack ?? test.err?.message,
        },
        diagnostics: allDiagnostics,
        activeEditor: active && {
            uri: active.document.uri.toString(),
            cursor: active.selection.active,
            text: active.document.getText(),
        },
        visibleEditors: window.visibleTextEditors.map(e => ({
            uri: e.document.uri.toString(),
            viewColumn: e.viewColumn,
            cursor: e.selection.active,
        })),
        openDocuments: workspace.textDocuments.map(d => ({
            uri: d.uri.toString(),
            languageId: d.languageId,
            isDirty: d.isDirty,
            lineCount: d.lineCount,
        })),
        outputChannels: getOutputChannelContents(),
    }

    try {
        fs.writeFileSync(file, JSON.stringify(dump, null, 2))
        console.log(`[state-dump] wrote ${file}`)
    } catch (e) {
        console.error(`[state-dump] failed to write ${file}: ${(e as Error).message}`)
    }
}

// Drop-in replacement for `afterEach(closeAllEditors)` that additionally writes
// a state-dump JSON whenever the just-finished test failed. Use as
// `afterEach(afterEachReset)` — must be a regular function (not arrow) so
// mocha's `this` binding reaches `dumpStateIfFailed`.
export async function afterEachReset(this: Context): Promise<void> {
    await dumpStateIfFailed(this)
    await closeAllEditors()
}
