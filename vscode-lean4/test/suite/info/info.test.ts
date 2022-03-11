import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen,
	assertStringInInfoview, findWord } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';

suite('InfoView Test Suite', () => {

	test('Copy to Comment', async () => {

		console.log('=================== Copy to Comment ===================');

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');

		let editor = await waitForActiveEditor();
		// make it a lean4 document even though it is empty and untitled.
		console.log('Setting lean4 language on untitled doc');
		await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4');

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(0, 0), '#eval Lean.versionString');
		});

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');

        console.log(`Found lean package version: ${lean.packageJSON.version}`);
		const info = lean.exports.infoProvider as InfoProvider;

		// If info view opens too quickly there is no LeanClient ready yet and
		// it's initialization gets messed up.
		assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 60 seconds');

		await assertStringInInfoview(info, '4.0.0-nightly-');

        console.log("Clicking copyToComment button in InfoView");
        await info.runTestScript("document.getElementById('copyToComment').click()");

        console.log("Checking editor contains '4.0.0-nightly'")
        await findWord(editor, "4.0.0-nightly");

	}).timeout(60000);

}).timeout(60000);
