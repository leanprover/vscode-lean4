import * as assert from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { commands } from 'vscode'
import type { DependencyInstallationProcedure, DepInstaller } from '../../src/utils/depInstaller'
import { activateExtension } from '../helpers/activation'
import { windowsPowerShellScript, windowsPowerShellScriptAsync } from '../helpers/powershell'
import { choose, dismiss, withPrompts } from '../helpers/prompts'
import { afterEachReset } from '../helpers/teardown'

// This file uninstalls the Git of the system and installs it again with the
// extension: one time with the Git installer, and one time with winget. The
// test home cannot isolate this: the installer writes to `C:\Program Files\Git`,
// to the registry and to the PATH of the system. Thus the tests run only if the
// workflow opts in with `LEAN4_TEST_INSTALL_SYSTEM_GIT=1`, and only on a
// GitHub-hosted runner, whose VM GitHub deletes after the job. A local run
// skips them.
//
// Each test uninstalls the Git of the runner first. Else the test cannot show
// that the extension installed Git.
//
// `scripts/cliTestNames.mjs` runs this file last: if an installation fails,
// Git stays missing.
const optInVariable = 'LEAN4_TEST_INSTALL_SYSTEM_GIT'

// The PowerShell function `Get-GitUninstallEntries` returns the entries of Git
// for Windows in "Installed apps", for all users and for the current user. The
// Git installer writes such an entry, also when winget starts it.
const getGitUninstallEntries = String.raw`
function Get-GitUninstallEntries {
    $roots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (Test-Path $root) {
            Get-ChildItem $root |
                ForEach-Object { Get-ItemProperty -Path $_.PSPath -ErrorAction SilentlyContinue } |
                Where-Object { $_.PSChildName -eq 'Git_is1' -or $_.Publisher -eq 'The Git Development Community' }
        }
    }
}
`

interface GitUninstallEntry {
    name: string
    version: string
    installLocation: string
}

function gitUninstallEntries(): GitUninstallEntry[] {
    const output = windowsPowerShellScript(
        getGitUninstallEntries +
            String.raw`
$ErrorActionPreference = 'Stop'
$entries = @(Get-GitUninstallEntries | ForEach-Object {
    [pscustomobject]@{
        name = "$($_.DisplayName)"
        version = "$($_.DisplayVersion)"
        installLocation = "$($_.InstallLocation)"
    }
})
ConvertTo-Json -InputObject $entries -Compress
`,
    )
    return JSON.parse(output) as GitUninstallEntry[]
}

// Runs the uninstaller of each entry. The uninstaller of Inno Setup runs a copy
// of itself from a temporary folder. Thus the script does not depend on
// `-Wait`: it also waits until the entries are gone.
async function uninstallGit(): Promise<void> {
    const output = await windowsPowerShellScriptAsync(
        getGitUninstallEntries +
            String.raw`
$ErrorActionPreference = 'Stop'
foreach ($entry in @(Get-GitUninstallEntries)) {
    $uninstaller = $entry.UninstallString.Trim('"')
    Write-Output "Uninstalling $($entry.DisplayName) $($entry.DisplayVersion) with $uninstaller"
    $process = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES' -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "The uninstaller of Git failed with exit code $($process.ExitCode)."
    }
}
$deadline = (Get-Date).AddMinutes(5)
while (@(Get-GitUninstallEntries).Count -gt 0) {
    if ((Get-Date) -gt $deadline) {
        throw 'The uninstaller of Git did not remove its entry in 5 minutes.'
    }
    Start-Sleep -Seconds 2
}
`,
        10 * 60_000,
    )
    console.log(output.trim() || 'No Git to uninstall.')
}

// The folders of a machine-wide and of a per-user installation of Git for
// Windows. `windowsGitInstallDirs` in `src/utils/depInstaller.ts` adds their
// `cmd` folders to PATH.
function gitInstallRoots(): string[] {
    const roots = [path.win32.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git')]
    if (process.env.LOCALAPPDATA !== undefined) {
        roots.push(path.win32.join(process.env.LOCALAPPDATA, 'Programs', 'Git'))
    }
    return roots
}

// Windows ignores the case of paths. The extension adds `c:\Program Files\Git\cmd`
// to PATH, and the PATH of the runner contains `C:\Program Files\Git\cmd`.
function normalizeDir(dir: string): string {
    return path.win32.normalize(dir).replace(/\\+$/, '').toLowerCase()
}

function isInside(dir: string, root: string): boolean {
    const d = normalizeDir(dir)
    const r = normalizeDir(root)
    return d === r || d.startsWith(r + '\\')
}

function pathEntries(): string[] {
    return (process.env.PATH ?? '').split(path.delimiter)
}

// Removes the entries of PATH for which `remove` is true. The tests run in the
// extension host, so the extension and the programs that it starts use this PATH.
function removeFromPath(remove: (dir: string) => boolean): void {
    process.env.PATH = pathEntries()
        .filter(dir => dir === '' || !remove(dir))
        .join(path.delimiter)
}

function containsFile(dir: string, file: string): boolean {
    return fs.existsSync(path.win32.join(dir, file))
}

// Uninstalls Git and removes its folders from PATH, so that the extension finds
// no Git. The extension added the folders of `gitInstallRoots` to PATH when it
// activated. Without them, the test also shows that the extension adds the
// folder of the new Git to PATH.
async function makeGitMissing(): Promise<void> {
    await uninstallGit()
    for (const root of gitInstallRoots()) {
        const gitExe = path.win32.join(root, 'cmd', 'git.exe')
        assert.ok(!fs.existsSync(gitExe), `${gitExe} still exists after the uninstallation of Git`)
    }
    removeFromPath(dir => gitInstallRoots().some(root => isInside(dir, root)) || containsFile(dir, 'git.exe'))
    const git = spawnSync('git', ['--version'], { env: process.env, encoding: 'utf8' })
    assert.ok(
        git.error !== undefined,
        `\`git --version\` still works after the uninstallation of Git: ${JSON.stringify(git.stdout)}`,
    )
}

// Checks the procedure for a missing Git, and returns its installation script.
function installationScript(p: DependencyInstallationProcedure, isWinGetAvailable: boolean): string {
    assert.ok(p.kind === 'Windows', `expected a procedure for Windows, got ${JSON.stringify(p)}`)
    assert.deepStrictEqual(
        {
            isGitAvailable: p.isGitAvailable,
            isCurlAvailable: p.isCurlAvailable,
            isWinGetAvailable: p.isWinGetAvailable,
        },
        { isGitAvailable: false, isCurlAvailable: true, isWinGetAvailable },
    )
    assert.ok(p.method.kind === 'Automatic', `expected an automatic installation, got ${JSON.stringify(p.method)}`)
    return p.method.script
}

async function installGitWithExtension(): Promise<void> {
    const result = await withPrompts(
        [choose(/^Do you wish to install `git`\?$/, 'Proceed'), dismiss(/^Dependency installation successful!$/)],
        async () => await commands.executeCommand<string>('lean4.setup.installDeps'),
    )
    assert.strictEqual(result, 'Success')
}

// Checks the new Git without the code of the extension, and then checks that
// the extension finds it without a restart of VS Code.
async function assertGitInstalled(depInstaller: DepInstaller, expectedVersion: string | RegExp): Promise<void> {
    const entries = gitUninstallEntries()
    assert.strictEqual(entries.length, 1, `expected one entry of Git in "Installed apps": ${JSON.stringify(entries)}`)
    const entry = entries[0]
    console.log(`Installed: ${entry.name} ${entry.version} in ${entry.installLocation}`)
    assert.ok(entry.installLocation !== '', `the entry of Git has no installation folder: ${JSON.stringify(entry)}`)

    const cmdDir = path.win32.join(entry.installLocation, 'cmd')
    const version = execFileSync(path.win32.join(cmdDir, 'git.exe'), ['--version'], { encoding: 'utf8' }).trim()
    if (typeof expectedVersion === 'string') {
        assert.strictEqual(version, expectedVersion)
    } else {
        assert.match(version, expectedVersion)
    }

    assert.ok(
        pathEntries().some(dir => dir !== '' && normalizeDir(dir) === normalizeDir(cmdDir)),
        `the extension did not add ${cmdDir} to PATH: ${process.env.PATH}`,
    )
    const p = await depInstaller.determineDependencyInstallationProcedure()
    assert.strictEqual(p.kind, 'AllDepsInstalled', `the extension does not find the new Git: ${JSON.stringify(p)}`)
}

describe('Git installation on Windows (real network, changes the system)', function () {
    // An uninstallation and an installation take some minutes each.
    this.timeout(20 * 60_000)

    let depInstaller: DepInstaller
    let originalPath: string | undefined

    before(async function () {
        if (process.env[optInVariable] !== '1') {
            console.log(`Skipping the tests of the Git installation: ${optInVariable} is not 1.`)
            this.skip()
        }
        if (process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
            throw new Error(
                `${optInVariable} is 1, but RUNNER_ENVIRONMENT is ${JSON.stringify(process.env.RUNNER_ENVIRONMENT)} ` +
                    'and not "github-hosted". These tests uninstall the Git of the system. Thus they run ' +
                    'only on a GitHub-hosted runner, whose VM GitHub deletes after the job.',
            )
        }
        if (process.platform !== 'win32') {
            console.log('Skipping the tests of the Git installation: they are for Windows.')
            this.skip()
        }
        depInstaller = (await activateExtension()).alwaysEnabledFeatures.depInstaller
        originalPath = process.env.PATH
    })

    // Each test removes folders from PATH, and the extension adds the folder of
    // the new Git.
    beforeEach(function () {
        if (originalPath !== undefined) {
            process.env.PATH = originalPath
        }
    })

    after(function () {
        if (originalPath !== undefined) {
            process.env.PATH = originalPath
        }
    })

    afterEach(afterEachReset)

    it('installs Git with the Git installer if winget is missing', async () => {
        await makeGitMissing()
        // Without winget, the extension downloads the Git installer and starts it.
        const localAppData = process.env.LOCALAPPDATA
        const windowsApps =
            localAppData !== undefined ? path.win32.join(localAppData, 'Microsoft', 'WindowsApps') : undefined
        removeFromPath(
            dir => containsFile(dir, 'winget.exe') || (windowsApps !== undefined && isInside(dir, windowsApps)),
        )

        const script = installationScript(await depInstaller.determineDependencyInstallationProcedure(), false)
        // The script downloads a fixed version.
        const release = /\/download\/v(\d+\.\d+\.\d+)\.windows\.(\d+)\//.exec(script)
        assert.ok(release, `the installation script contains no release of Git for Windows:\n${script}`)

        await installGitWithExtension()

        await assertGitInstalled(depInstaller, `git version ${release[1]}.windows.${release[2]}`)
    })

    it('installs Git with winget', async function () {
        const winget = spawnSync('winget', ['--version'], { env: process.env, encoding: 'utf8' })
        if (winget.error !== undefined || winget.status !== 0) {
            console.log(
                'Skipping the test with winget: `winget --version` failed ' +
                    `(${winget.error?.message ?? `exit code ${winget.status}`}).`,
            )
            this.skip()
        }
        await makeGitMissing()

        const script = installationScript(await depInstaller.determineDependencyInstallationProcedure(), true)
        assert.match(script, /^winget install /)

        await installGitWithExtension()

        await assertGitInstalled(depInstaller, /^git version \d+\.\d+\.\d+\.windows\.\d+$/)
    })
})
