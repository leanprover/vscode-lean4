import * as assert from 'node:assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTestWorkDir } from './testHome'

// The fixtures in the source tree. At runtime, `__dirname` is `out/test/helpers`.
export const FIXTURES = path.resolve(__dirname, '../../../test/fixtures')

// Copies the fixture `fixtureName` into a new folder in the test home and
// returns its path. Use it for tests that change the project (build, update,
// `lean-toolchain`, git). The next test run deletes the copy.
export function scaffoldFromFixture(fixtureName: string, prefix: string): string {
    const dst = path.join(makeTestWorkDir(prefix), fixtureName)
    fs.cpSync(path.join(FIXTURES, fixtureName), dst, { recursive: true })
    return dst
}

// Fails if `dir` or a folder above it contains a `lean-toolchain` file or a
// lakefile. The extension looks for the project of a file up to the root
// folder, so such a file makes a file in `dir` part of a project. Call it in
// tests of files outside of a project, so that they fail with a clear message.
export function assertNotInProject(dir: string): void {
    for (let folder = path.resolve(dir); ; folder = path.dirname(folder)) {
        for (const name of ['lean-toolchain', 'lakefile.lean', 'lakefile.toml']) {
            const file = path.join(folder, name)
            assert.ok(
                !fs.existsSync(file),
                `precondition: ${dir} must not be in a Lean project, but ${file} exists. ` +
                    'Remove the file, or move the folder of the tests.',
            )
        }
        if (path.dirname(folder) === folder) return
    }
}
