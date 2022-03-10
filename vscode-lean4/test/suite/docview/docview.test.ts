import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';

import { initLean4, waitForActiveEditor, waitForHtmlString,
	extractPhrase, waitForDocViewHtml, invokeHrefCommand } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { DocViewProvider } from '../../../src/docview';

suite('Documentation View Test Suite', () => {

	test('Documentation View Example Test', async () => {
		// This test opens the documentation view and selects the "Example" link.
		console.log('=================== Documentation View Example Test ===================');

		void vscode.window.showInformationMessage('Running tests: ' + __dirname);
		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
		const mainFile = path.join(testsRoot, 'Main.lean');
		const lean = await initLean4(mainFile);

		const info = lean.exports.infoProvider as InfoProvider;
		const expectedVersion = 'Hello:';
		let html = await waitForHtmlString(info, expectedVersion);
		const versionString = extractPhrase(html, 'Hello:', '<').trim();
		console.log(`>>> Found "${versionString}" in infoview`)

		await vscode.commands.executeCommand('lean4.docView.open');

		const docView = lean.exports.docView as DocViewProvider;
		const exampleLink = 'Example';
		html = await waitForDocViewHtml(docView, exampleLink);

    	// invoke the command in the <a> tag with href containing 'openExample
		await invokeHrefCommand(html, 'a[href*="openExample"]')

		const example = await waitForActiveEditor('Untitled-1');
        assert(example, 'Example file not opened');

        // the example should be active and should be showing this in the info view.
        const exampleOuput = 'Hello, world!';
		await waitForHtmlString(info, exampleOuput);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

	}).timeout(60000);

}).timeout(60000);
