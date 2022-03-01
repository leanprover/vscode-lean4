import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { waitForActiveExtension, waitForActiveEditor, assertLeanServers, findLeanServers} from '../utils/helpers';

suite('Lean3 Compatibility Test Suite', () => {

	test('Lean3 project', async () => {
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const [servers, workers] = await findLeanServers();
		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'projects', 'lean3');

		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		await waitForActiveEditor();

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

		// since this only loaded a lean3 project, we should have 1 new lean server
		// for the lean3, but no lean4 server.
		await assertLeanServers(servers + 1, workers + 0);

	});

}).timeout(60000);
