import * as path from 'path';
import * as cp from 'child_process';
import { runTests, downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../../vscode-lean4');

		// This will download VS Code, unzip it and run the integration test
		const vscodeExecutablePath = await downloadAndUnzipVSCode('1.64.2');

		// Install the lean3 extension! [TODO: this doesn't seem to be working]
		const [cli, ...args] = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
		cp.spawnSync(cli, [...args, '--install-extension', 'jroesch.lean'], {
			encoding: 'utf-8',
			stdio: 'inherit'
		});

		// run the lean3 test in one vs code instance
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath: path.resolve(__dirname, './lean3'),
			launchArgs: ['--new-window', '--disable-gpu', '--disable-extension', 'platformio.platformio-ide'] });

		// This will download VS Code, unzip it and run the integration test
		// const version2 = await downloadAndUnzipVSCode('1.64.0');

		// run the lean4 tests in a separate vs code instance
		await runTests({
			vscodeExecutablePath,
			extensionDevelopmentPath,
			extensionTestsPath:path.resolve(__dirname, './suite'),
			launchArgs: ['--new-window', '--disable-gpu', '--disable-extension', 'platformio.platformio-ide'] });

	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

void main();
