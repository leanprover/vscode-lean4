import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { sleep, waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString, extractToTerminator, findWord } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';

suite('Extension Test Suite', () => {

	test('Untitled Lean File', async () => {
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');

		const editor = await waitForActiveEditor();
		assert(editor, 'Missing active text editor');

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(0, 0), '#eval Lean.versionString');
		});

		// make it a lean4 document even though it is empty and untitled.
		console.log('Setting lean4 language on untitled doc');
		await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4');

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');

        console.log(`Found lean package version: ${lean.packageJSON.version}`);
		const info = lean.exports.infoview as InfoProvider;

        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 60 seconds');

		const expectedVersion = '4.0.0-nightly-';
		const [html, found] = await waitForHtmlString(info, expectedVersion);
		const pos = html.indexOf('4.0.0-nightly-');
		if (pos >= 0) {
			// 4.0.0-nightly-2022-02-16
			const versionString = html.substring(pos, pos + 24)
			console.log(`>>> Found "${versionString}" in infoview`)
		}

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000); // make sure it shuts down fully before next test.
	}).timeout(60000);

	test('Load Lean File from a package folder', async () => {

		// Test we can load an adhoc file from a package folder and also
		// have goto definition work showing that the LeanClient is correctly
		// running in the package root.
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		// D:\git\leanprover\vscode-lean4\test\src\suite\simple\Main.lean
		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'suite', 'simple');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForActiveExtension('leanprover.lean4');
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

		const info = lean.exports.infoview as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		let expectedVersion = 'Hello:';
		let [html, found] = await waitForHtmlString(info, expectedVersion);
		let pos = html.indexOf('Hello:');
		if (pos >= 0) {
			// Hello: 4.0.0-nightly-2022-02-17
			const versionString = extractToTerminator(html, pos, '<').trim();
			console.log(`>>> Found "${versionString}" in infoview`)
		}

		const wordRange = findWord(editor, 'getLeanVersion');
		assert(wordRange, 'Missing getLeanVersion in Main.lean');

		// The -1 is to workaround a bug in goto definition.
		// The cursor must be placed before the end of the identifier.
		const secondLastChar = new vscode.Position(wordRange.end.line, wordRange.end.character - 1);
		editor.selection = new vscode.Selection(wordRange.start, secondLastChar);

		await vscode.commands.executeCommand('editor.action.revealDefinition');

		// if goto definition worked, then we are in Version.lean and we should see the Lake version string.
		expectedVersion = 'Lake Version:';
		[html, found] = await waitForHtmlString(info, expectedVersion);
		pos = html.indexOf('Lake Version:');
		if (pos >= 0) {
			// Lake Version: 4.0.0-nightly-2022-02-17
			const versionString = extractToTerminator(html, pos, '"');
			console.log(`>>> Found "${versionString}" in infoview`)
		} else {
			assert(false, 'Lake Version: not found in infoview');
		}

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await sleep(1000); // make sure it shuts down fully before next test.
	}).timeout(60000);

}).timeout(60000);
