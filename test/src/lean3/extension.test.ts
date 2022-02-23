import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { waitForActiveExtension, waitForActiveEditor, sleep } from '../utils/helpers';

suite('Extension Test Suite', () => {

	test('Lean3 project', async () => {
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const testsRoot = path.join(__dirname, '..', '..', 'suite', 'lean3');

		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const editor = await waitForActiveEditor();
		assert(editor, 'Missing active text editor');

		const lean3 = await waitForActiveExtension('jroesch.lean');
		assert(lean3, 'Lean3 extension not loaded');

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');
		assert(!lean.exports.isLean4Project, 'Lean4 extension should not be running!');

		console.log('Checking vscode commands...');
		const cmds = await vscode.commands.getCommands(true);
		cmds.forEach(cmd => {
			assert(cmd !== 'lean4.selectToolchain', 'Lean4 extension should not have any registered commands');
		});

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await sleep(1000); // make sure it shuts down fully before next test.
	});

}).timeout(60000);
