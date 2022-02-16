import * as assert from 'assert';
import { fstat, readFileSync } from 'fs';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { TestApi } from '@lean4/infoview-api';
import { sleep, waitForLeanExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString } from './utils';

suite('Extension Test Suite', () => {

	test('Untitled Lean File', async () => {
		void vscode.window.showInformationMessage('Running tests...');
		await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');

		const editor = await waitForActiveEditor();
		assert(editor, 'Missing active text editor');

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(0, 0), '#eval Lean.versionString');
		});

		// make it a lean4 document even though it is empty and untitled.
		console.log('Setting lean4 language on untitled doc');
		await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4');

		const lean = await waitForLeanExtension();
		assert(lean, 'Lean extension not loaded');

        console.log(`Found lean package version: ${lean.packageJSON.version}`);

		const testApi : TestApi = lean.exports.testApi as TestApi;
        assert(await waitForInfoViewOpen(testApi, 60),
			'Info view did not open after 60 seconds');

		const expectedVersion = '4.0.0-nightly-';
		const [html, found] = await waitForHtmlString(testApi, expectedVersion);
		console.log('>>> infoview contents:')
		console.log(html);
		const pos = html.indexOf('4.0.0-nightly-');
		if (pos >= 0) {
			// 4.0.0-nightly-2022-02-16
			const versionString = html.substring(pos, pos + 24)
			console.log(`>>> Found "${versionString}" in infoview`)
		}
        assert(found, `Missing "${expectedVersion}" in infoview`)

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(2000); // make sure it shuts down fully before next test.
	}).timeout(60000);

	test('Load Lean File from a package folder', async () => {

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

		// since we closed the infoview in the first test we have to manually open it this time.
		await vscode.commands.executeCommand('lean4.displayGoal');

		const testApi : TestApi = lean.exports.testApi as TestApi;
        assert(await waitForInfoViewOpen(testApi, 60),
			'Info view did not open after 20 seconds');

		const expectedVersion = '4.0.0-nightly-';
		const [html, found] = await waitForHtmlString(testApi, expectedVersion);
		console.log('>>> infoview contents:')
		console.log(html);
		const pos = html.indexOf('4.0.0-nightly-');
		if (pos >= 0) {
			// 4.0.0-nightly-2022-02-16
			const versionString = html.substring(pos, pos + 24)
			console.log(`>>> Found "${versionString}" in infoview`)
		}
		assert(found, `Missing "${expectedVersion}" in infoview`)

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(2000); // make sure it shuts down fully before next test.
	}).timeout(60000);

}).timeout(60000);
