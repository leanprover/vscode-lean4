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

		// verify we have a nightly build runnning in this folder.
		let expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Now open a file from the other project
		const doc2 = await vscode.workspace.openTextDocument(path.join(testsRoot, 'foo', 'Foo.lean'));
		await vscode.window.showTextDocument(doc2);

		// verify that a different version of lean is running here (leanprover/lean4:stable)
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now verify we have 2 LeanClients running.
		const clients = lean.exports.clientProvider as LeanClientProvider;
		assert(clients.getClients().length === 2, "Expected 2 LeanClients to be running");

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000); // make sure it shuts down fully before next test.
	}).timeout(60000);


	test('Test select toolchain', async () => {

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

		// Now make sure the toolchain is reset (in case previous test failed).
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		// since we closed the infoview in the first test we have to manually open it this time.
		await vscode.commands.executeCommand('lean4.displayGoal');

		const info = lean.exports.infoProvider as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		// verify we have a nightly build runnning in this folder.
		let expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Now switch toolchains
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

		// verify that a we switched to leanprover/lean4:stable
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now verify we have 2 LeanClients running.
		const clients = lean.exports.clientProvider as LeanClientProvider;
		assert(clients.getClients().length === 2, "Expected 2 LeanClients to be running");

		// Now reset the toolchain for next debug test run.
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000); // make sure it shuts down fully before next test.
	}).timeout(60000);


}).timeout(60000);
