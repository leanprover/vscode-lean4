import * as path from 'path';
import * as cp from 'child_process';

console.log(__dirname);

import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath  } from '@vscode/test-electron';
import * as fs from 'fs';

function clearUserWorkspaceData(vscodeTest: string) {
    const workspaceData = path.join(vscodeTest, 'user-data', 'Workspaces');
    fs.rmdir(workspaceData, { recursive: true }, (err) => {
        console.log(`deleted user workspace data ${workspaceData} is deleted!`);
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
		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		// Install the lean3 extension!
		const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath (vscodeExecutablePath);
		cp.spawnSync(cli, [...args, '--install-extension', 'jroesch.lean'], {
			encoding: 'utf-8',
			stdio: 'inherit'
		});

		// run the lean3 test in one vs code instance, using `open folder` since
		// lean3 doesn't lile ad-hoc files.
		const testFolder = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'lean3');

		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, 'lean3'),
			launchArgs: ['--new-window', '--disable-gpu', testFolder] });

		// The '--new-window' doesn't see to be working, so this hack
		// ensures the following test does not re-open the lean3 folder
		clearUserWorkspaceData(vscodeTestPath);

		// run the infoView tests

		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, 'info'),
			launchArgs: ['--new-window', '--disable-gpu'] });

		// The '--new-window' doesn't see to be working, so this hack
		// ensures the following test does not re-open the lean3 folder
		clearUserWorkspaceData(vscodeTestPath);

		// run the lean4 tests in adhoc file configuration (no folder open)
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath:path.resolve(__dirname, 'simple'),
			launchArgs: ['--new-window', '--disable-gpu'] });


		const lean4TestFolder = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'simple');

		// The '--new-window' doesn't see to be working, so this hack
		// ensures the following test does not re-open the lean3 folder
		clearUserWorkspaceData(vscodeTestPath);

		// run the lean4 simple tests again, this time with an "open folder" configuration
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath:path.resolve(__dirname, 'simple'),
			launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder] });

		// The '--new-window' doesn't see to be working, so this hack
		// ensures the following test does not re-open the lean3 folder
		clearUserWorkspaceData(vscodeTestPath);

		const workspacePath = path.join(extensionDevelopmentPath, 'test', 'test-fixtures', 'multi', 'multi.code-workspace');

		// Test a multi-folder workspace.
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath:path.resolve(__dirname, 'multi'),
			launchArgs: ['--new-window', '--disable-gpu', workspacePath] });

		// Test documentation view.
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath:path.resolve(__dirname, 'docview'),
			launchArgs: ['--new-window', '--disable-gpu', lean4TestFolder] });


	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

void main();
