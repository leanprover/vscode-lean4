import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTestWorkDir } from './testHome'

// Integration tests read fixture files from disk at runtime. They live under
// `vscode-lean4/test/fixtures/` — i.e. the source tree, not `out/`. Centralized
// so tests don't hand-count `..` hops every time the layout shifts.
// At runtime `__dirname` is `<pkg>/out/test/helpers`; step up past `out/` and
// down into the source `test/fixtures/`.
export const FIXTURES = path.resolve(__dirname, '../../../test/fixtures')

// Copies the fixture at `test/fixtures/<fixtureName>/` into a fresh tmpdir
// under the isolated test HOME and returns the destination path. Use this for
// any test that mutates the project (lake build/update, toolchain rewrites,
// `git init`) — leaving the fixture in the source tree pristine while each
// test gets an isolated, throwaway copy. The tmpdir is leaked on purpose;
// LEAN4_TEST_HOME is wiped between runs.
export function scaffoldFromFixture(fixtureName: string, prefix: string): string {
    const dst = path.join(makeTestWorkDir(prefix), fixtureName)
    fs.cpSync(path.join(FIXTURES, fixtureName), dst, { recursive: true })
    return dst
}
