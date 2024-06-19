import * as cp from 'child_process'
import * as path from 'path'

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron'
import * as fs from 'fs'
import { logger } from '../../src/utils/logger'

function clearUserWorkspaceData(vscodeTest: string) {
    const workspaceData = path.join(vscodeTest, 'user-data', 'Workspaces')
    fs.rmdir(workspaceData, { recursive: true }, err => {
        logger.log(`deleted user workspace data ${workspaceData} is deleted!`)
    })
}

function getLeanTestVersion() {
    const testsRoot = path.join(__dirname, '..', '..', '..', 'test')
    const simple = path.join(testsRoot, 'test-fixtures', 'simple')
    const toolchain = fs.readFileSync(path.join(simple, 'lean-toolchain'), 'utf8').toString()
    return toolchain.trim()
}

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`

        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..')

        const test_version = getLeanTestVersion()

        // make sure we are in a clean state
        const vscodeTestPath = path.resolve(__dirname, '.vscode-test')
        clearUserWorkspaceData(vscodeTestPath)

        // This will download VS Code, unzip it and run the integration test
        let vscodeExecutablePath: string

        if (process.platform === 'win32') {
            vscodeExecutablePath = await downloadAndUnzipVSCode({
                platform: 'win32-x64-archive',
            })
        } else {
            vscodeExecutablePath = await downloadAndUnzipVSCode()
        }

        // Install the lean3 extension!
        const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath)
        cp.spawnSync(cli, [...args, '--install-extension', 'jroesch.lean'], {
            encoding: 'utf-8',
            stdio: 'inherit',
        })

        clearUserWorkspaceData(vscodeTestPath)

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath)

        // run bootstrap tests
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'bootstrap', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu'],
        })

        clearUserWorkspaceData(vscodeTestPath)

        // now that elan is installed we can run the lean3 test in one vs code instance,
        // using `open folder` since lean3 doesn't like ad-hoc files.

        clearUserWorkspaceData(vscodeTestPath)

        // run the infoView tests
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'info', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu'],
        })

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath)

        // run the lean4 tests in adhoc file configuration (no folder open)
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'simple', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu'],
        })

        const lean4TestFolder = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'simple')

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath)

        // run the lean4 simple tests again, this time with an "open folder" configuration
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'simple', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder],
        })

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath)

        // run the lean4 toolchain tests, also reusing the 'simple' project.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'toolchains', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder],
        })

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath)

        // run the lean4 restart tests, also reusing the 'simple' project.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'restarts', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder],
        })

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath)

        const workspacePath = path.join(
            extensionDevelopmentPath,
            'test',
            'test-fixtures',
            'multi',
            'multi.code-workspace',
        )

        // Test a multi-folder workspace.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, 'index'),
            extensionTestsEnv: { LEAN4_TEST_FOLDER: 'multi', DEFAULT_LEAN_TOOLCHAIN: test_version },
            launchArgs: ['--new-window', '--disable-gpu', workspacePath],
        })
    } catch (err) {
        console.error('Failed to run tests')
        console.error(err.message)
        process.exit(1)
    }
}

void main()
