import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Single source of truth for the per-file `cli-*` labels in `.vscode-test.mjs`
// and the chained `--label` invocation in `package.json`'s
// `test:vscode-test-cli` script. Reads the TS sources (not `out/`) so the list
// is correct even before `compile-tests` has run.
const here = dirname(fileURLToPath(import.meta.url))
export const cliTestNames = readdirSync(resolve(here, '..', 'test', 'vscode-test-cli'))
    .filter(f => f.endsWith('.test.ts'))
    .map(f => f.replace(/\.test\.ts$/, ''))
    .sort()
