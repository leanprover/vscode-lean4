import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

// The Elan script `scripts/elan-install/install-windows.ps1` and the Git script
// `windowsRawGitInstallScript` in `src/utils/depInstaller.ts` start with the
// same lines for the proxy credentials (`scripts/installation-scripts.md`).
// This test finds a difference. `depInstaller.ts` imports `vscode`, so the test
// reads it as text.

// Returns the lines of the `if` block for the proxy credentials without their
// indentation, and the index of the first line in the script.
function proxyBlock(script: string): { lines: string[]; start: number } | undefined {
    const lines = script.split(/\r?\n/)
    const start = lines.findIndex(line => line.trim().startsWith('if ($ExecutionContext.SessionState.LanguageMode'))
    if (start === -1) return undefined
    const indent = lines[start].length - lines[start].trimStart().length
    const end = lines.findIndex((line, i) => i > start && line === ' '.repeat(indent) + '}')
    if (end === -1) return undefined
    return { lines: lines.slice(start, end + 1).map(line => line.slice(indent)), start }
}

describe('the proxy credentials of the Windows install scripts', () => {
    const extensionDir = path.join(__dirname, '..', '..')
    const elanScript = fs.readFileSync(
        path.join(extensionDir, 'scripts', 'elan-install', 'install-windows.ps1'),
        'utf8',
    )
    const depInstallerTs = fs.readFileSync(path.join(extensionDir, 'src', 'utils', 'depInstaller.ts'), 'utf8')
    const gitScript = /const windowsRawGitInstallScript = `([^`]*)`/.exec(depInstallerTs)?.[1]

    it('are the same lines in the Elan script and in the Git script', () => {
        expect(gitScript, '`windowsRawGitInstallScript` in src/utils/depInstaller.ts').toBeDefined()
        const elanBlock = proxyBlock(elanScript)
        const gitBlock = proxyBlock(gitScript!)
        expect(elanBlock, 'the proxy lines in install-windows.ps1').toBeDefined()
        expect(gitBlock, 'the proxy lines in `windowsRawGitInstallScript`').toBeDefined()
        expect(gitBlock!.lines).toEqual(elanBlock!.lines)
    })

    // The credentials must be set before the first download.
    it.each([
        ['install-windows.ps1', () => elanScript],
        ['`windowsRawGitInstallScript`', () => gitScript!],
    ])('come before the first download in %s', (_name, script) => {
        const lines = script().split(/\r?\n/)
        const download = lines.findIndex(line => line.includes('Invoke-WebRequest'))
        expect(download).toBeGreaterThan(-1)
        expect(proxyBlock(script())!.start).toBeLessThan(download)
    })
})
