import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		let  extensionDevelopmentPath = path.resolve(__dirname, '../../../vscode-lean4');
		if (extensionDevelopmentPath.indexOf('/vscode-lean4/vscode-lean4/vscode-lean4') >= 0) {
			// not sure why but on the github CI the __dirname is in a different place...
			extensionDevelopmentPath = path.resolve(__dirname, '../../..')
		}

		console.log(`##### extensionDevelopmentPath=${extensionDevelopmentPath}`);
		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test
		await runTests({ extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: ['--new-window'] });
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

void main();
