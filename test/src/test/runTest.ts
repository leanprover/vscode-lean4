import * as path from 'path';
import * as cp from 'child_process';
import { runTests, downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
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
		const extensionDevelopmentPath = path.resolve(__dirname, '../../../vscode-lean4');

		// make sure we are in a clean state
		const vscodeTestPath = path.resolve(__dirname, '../../.vscode-test');
		clearUserWorkspaceData(vscodeTestPath);

		// This will download VS Code, unzip it and run the integration test
		const vscodeExecutablePath = await downloadAndUnzipVSCode();

		// Install the lean3 extension!
		const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
		cp.spawnSync(cli, [...args, '--install-extension', 'jroesch.lean'], {
			encoding: 'utf-8',
			stdio: 'inherit'
		});

		// run the lean3 test in one vs code instance
		const testFolder = path.join(__dirname, '..', '..', 'src', 'lean', 'lean3');

		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, './lean3'),
			launchArgs: ['--new-window', '--disable-gpu', testFolder] });

		// The '--new-window' doesn't see to be working, so this hack
		// ensures the following test does not re-open the lean3 folder
		clearUserWorkspaceData(vscodeTestPath);

		// run the lean4 tests in a separate vs code instance
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath:path.resolve(__dirname, './suite'),
			launchArgs: ['--new-window', '--disable-gpu'] });

	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}


void main();
