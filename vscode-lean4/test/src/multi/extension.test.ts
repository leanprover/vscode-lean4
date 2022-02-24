import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep, waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString, extractToTerminator, findWord } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { LeanClientProvider} from '../../../src/utils/clientProvider';

suite('Extension Test Suite', () => {

	test('Load Lean Files in a multi-project workspace', async () => {

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'multi');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'test', 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');
		assert(lean.exports.isLean4Project);
		assert(lean.isActive);
        console.log(`Found lean package version: ${lean.packageJSON.version}`);

		await waitForActiveEditor('Main.lean');

		// since we closed the infoview in the first test we have to manually open it this time.
		await vscode.commands.executeCommand('lean4.displayGoal');

		const info = lean.exports.infoProvider as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		let expectedVersion = 'Hello, test!';
		await waitForHtmlString(info, expectedVersion);

		// Now open a file from the other project
		const doc2 = await vscode.workspace.openTextDocument(path.join(testsRoot, 'foo', 'Main.lean'));
		await vscode.window.showTextDocument(doc2);

		let expected2 = 'Hello, foo!';
		await waitForHtmlString(info, expected2);

		// Now verify we have 2 LeanClients running.
		const clients = lean.exports.clientProvider as LeanClientProvider;
		assert(clients.getClients().length === 2, "Expected 2 LeanClients to be running");

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000); // make sure it shuts down fully before next test.
	}).timeout(60000);

}).timeout(60000);
