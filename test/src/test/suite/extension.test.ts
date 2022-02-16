import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep, waitForLeanExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString } from './utils';

suite('Extension Test Suite', () => {

	test('Load Lean File', async () => {

		void vscode.window.showInformationMessage('Running tests...');

		const testsRoot = path.join(__dirname, '..', '..', '..', 'src', 'lean', 'test');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForLeanExtension();
		assert(lean, 'Lean extension not loaded');

		assert(lean.exports.isLean4Project);
		assert(lean.isActive);

        console.log(`Found lean package version: ${lean.packageJSON.version}`);

		const editor = await waitForActiveEditor();
		assert(editor, 'Missing active text editor');
		console.log(`loaded document ${editor.document.uri}`);

		assert(editor.document.uri.fsPath.endsWith('Main.lean'));

        const info = await waitForInfoViewOpen(lean.exports, 20);
        assert(info?.isOpen(), 'InfoView is not opening?');

        const html = await waitForHtmlString(info.getWebView(), '4.0.0-nightly-2022-02-06');
        assert(html, 'Version "4.0.0-nightly-2022-02-06" not found in infoview')

        console.log(html);
	});
}).timeout(60000);
