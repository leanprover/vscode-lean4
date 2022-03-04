import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import cheerio = require('cheerio');

import { waitForActiveExtension, waitForActiveEditor, waitForInfoViewOpen, waitForHtmlString,
	extractPhrase, waitForDocViewHtml } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';
import { DocViewProvider } from '../../../src/docview';

suite('Documentation View Test Suite', () => {

	test('Documentation View Example Test', async () => {
		console.log('=================== Documentation View Example Test ===================');

		// This test opens the documentation view and selects the "Example" link.
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		void vscode.window.showInformationMessage('Running tests: ' + __dirname);

		const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
		const doc = await vscode.workspace.openTextDocument(path.join(testsRoot, 'Main.lean'));
		await vscode.window.showTextDocument(doc);

		const lean = await waitForActiveExtension('leanprover.lean4');
		assert(lean, 'Lean extension not loaded');
		assert(lean.exports.isLean4Project);
		assert(lean.isActive);
        console.log(`Found lean package version: ${lean.packageJSON.version}`);
		const editor = await waitForActiveEditor('Main.lean');

		const info = lean.exports.infoProvider as InfoProvider;
        assert(await waitForInfoViewOpen(info, 60),
			'Info view did not open after 20 seconds');

		let expectedVersion = 'Hello:';
		let html = await waitForHtmlString(info, expectedVersion);
		const versionString = extractPhrase(html, 'Hello:', '<').trim();
		console.log(`>>> Found "${versionString}" in infoview`)

		await vscode.commands.executeCommand('lean4.docView.open');

		const docView = lean.exports.docView as DocViewProvider;
		const exampleLink = 'Example';
		html = await waitForDocViewHtml(docView, exampleLink);

        const $ = cheerio.load(html);
        // find <a> tag with href containing 'openExample
        const link = $('a[href*="openExample"]');
        assert(link, 'openExample link not found')
        if (link) {
            const href = link.attr('href');
            if (href) {
                const prefix = 'command:'
                assert(href.startsWith(prefix), `expecting the href to start with ${prefix}`);
                const cmd = href.slice(prefix.length);
                const uri = vscode.Uri.parse(cmd);
                const query = decodeURIComponent(uri.query);
                console.log(`Opening file : ${query}`);
                const args = JSON.parse(query);
                await vscode.commands.executeCommand(uri.path.slice(1), args);
            }
        }

		const example = await waitForActiveEditor('Untitled-1');
        assert(example, 'Example file not opened');

        // the example should be active and should be showing this in the info view.
        const exampleOuput = 'Hello, world!';
		await waitForHtmlString(info, exampleOuput);

		// make sure test is always run in predictable state, which is no file or folder open
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

	}).timeout(60000);

}).timeout(60000);
