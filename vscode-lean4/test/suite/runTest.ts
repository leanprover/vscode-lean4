import * as path from 'path';
import * as cp from 'child_process';

import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import * as fs from 'fs';
import { DownloadArchitecture } from '@vscode/test-electron/out/download';
import { logger } from '../../src/utils/logger'

function clearUserWorkspaceData(vscodeTest: string) {
    const workspaceData = path.join(vscodeTest, 'user-data', 'Workspaces');
    fs.rmdir(workspaceData, { recursive: true }, (err) => {
        logger.log(`deleted user workspace data ${workspaceData} is deleted!`);
    });
}

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`

        const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..');

        // make sure we are in a clean state
        const vscodeTestPath = path.resolve(__dirname, '.vscode-test');
        clearUserWorkspaceData(vscodeTestPath);

        // This will download VS Code, unzip it and run the integration test
        let vscodeExecutablePath: string;

        if (process.platform === 'win32') {
            vscodeExecutablePath = await downloadAndUnzipVSCode({
                platform: 'win32-x64-archive',
                architecture : DownloadArchitecture.X64});
        }
        else{
            vscodeExecutablePath = await downloadAndUnzipVSCode();
        }

        // Install the lean3 extension!
        const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath (vscodeExecutablePath);
        cp.spawnSync(cli, [...args, '--install-extension', 'jroesch.lean'], {
            encoding: 'utf-8',
            stdio: 'inherit'
        });

        clearUserWorkspaceData(vscodeTestPath);

		// run bootstrap tests
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'bootstrap'},
			launchArgs: ['--new-window', '--disable-gpu'] });

        clearUserWorkspaceData(vscodeTestPath);

        // now that elan is installed we can run the lean3 test in one vs code instance,
        // using `open folder` since lean3 doesn't like ad-hoc files.

        // BUGBUG: this test has begun to fail on newer vscode builds with "Uncaught Error: write EPIPE"
        // await runTests({
        //     vscodeExecutablePath,
        //     extensionDevelopmentPath,
        //     extensionTestsPath: path.resolve(__dirname, 'index'),
        //     extensionTestsEnv: {'TEST_FOLDER': 'lean3'},
        //     launchArgs: ['--new-window', '--disable-gpu'] });
        // // The '--new-window' doesn't see to be working, so this hack
        // // ensures the following test does not re-open the lean3 folder
        // clearUserWorkspaceData(vscodeTestPath);

		// run 'no elan' tests
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'simple', 'DISABLE_ELAN': '1'},
			launchArgs: ['--new-window', '--disable-gpu'] });

        clearUserWorkspaceData(vscodeTestPath);

		// run the infoView tests
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'info', 'DISABLE_ELAN': '1'},
			launchArgs: ['--new-window', '--disable-gpu'] });

		// The '--new-window' doesn't see to be working, so this hack
		// ensures the following test does not re-open the previous folder
		clearUserWorkspaceData(vscodeTestPath);

		// run the lean4 tests in adhoc file configuration (no folder open)
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'simple'},
			launchArgs: ['--new-window', '--disable-gpu'] });


        const lean4TestFolder = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'simple');

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath);

        // run the lean4 simple tests again, this time with an "open folder" configuration
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'simple'},
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder] });

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath);

        // run the lean4 toolchain tests, also reusing the 'simple' project.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'toolchains'},
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder] });

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath);

        // run the lean4 restart tests, also reusing the 'simple' project.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'restarts'},
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder] });

        // The '--new-window' doesn't see to be working, so this hack
        // ensures the following test does not re-open the previous folder
        clearUserWorkspaceData(vscodeTestPath);

        const workspacePath = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'multi', 'multi.code-workspace');

        // Test a multi-folder workspace.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'multi'},
            launchArgs: ['--new-window', '--disable-gpu', workspacePath] });

        // Test documentation view.
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath:path.resolve(__dirname, 'index'),
            extensionTestsEnv: {'TEST_FOLDER': 'docview'},
            launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder] });


    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

void main();
