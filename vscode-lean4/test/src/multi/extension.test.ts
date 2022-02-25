import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { sleep, waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString, extractToTerminator, findWord } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { LeanClientProvider} from '../../../src/utils/clientProvider';
import { LeanInstaller } from '../../../src/utils/leanInstaller';

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

		// verify that we switched to leanprover/lean4:stable
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Now reset the toolchain back to nightly build.
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForHtmlString(info, expectedVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	}).timeout(60000);


	test('Test lean-toolchain edits', async () => {

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

		// turn off the user prompts so restart of lean server happens automatically.
		const installer = lean.exports.installer as LeanInstaller;
		installer.setPromptUser(false);

		// verify we have a nightly build runnning in this folder.
		let expectedVersion = '4.0.0-nightly-';
		await waitForHtmlString(info, expectedVersion);

		// Now edit the lean-toolchain file.
		const toolchainFile = path.join(testsRoot, 'test', 'lean-toolchain');
		const originalContents = fs.readFileSync(toolchainFile, 'utf8').toString();
		assert(originalContents.trim() === 'leanprover/lean4:nightly');
		// Switch to stable version.
		fs.writeFileSync(toolchainFile, 'leanprover/lean4:stable');

		// verify that we switched to leanprover/lean4:stable
		let expected2 = '4.0.0, commit';
		await waitForHtmlString(info, expected2);

		// Switch back to original version.
		fs.writeFileSync(toolchainFile, originalContents);

		// Now make sure the reset works and we can go back to the previous nightly version.
		await waitForHtmlString(info, expectedVersion);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	}).timeout(60000);


}).timeout(60000);
