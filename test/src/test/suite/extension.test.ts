import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep, waitForLeanExtension, waitForActiveEditor } from './utils';

suite('Extension Test Suite', () => {

	test('Load Lean File', async () => {

		vscode.window.showInformationMessage('Running tests...');

		const testsRoot = path.join(__dirname, '..', '..', '..', 'src', 'lean', 'test');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForLeanExtension();
		assert(lean, "Lean extension not loaded");

		assert(lean.exports.isLean4Project);
		assert(lean.isActive);

		const editor = await waitForActiveEditor();
		assert(editor, "Missing active text editor");
		console.log(`loaded document ${editor.document.uri}`);

		assert(editor.document.uri.fsPath.endsWith('Main.lean'));

		await sleep(10000);

	});
}).timeout(10000);
