import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';

import { initLean4, waitForActiveEditor, waitForInfoviewHtml, closeAllEditors,
	extractPhrase, waitForDocViewHtml, invokeHrefCommand } from '../utils/helpers';

function delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
}

suite('Documentation View Test Suite', () => {

    test('Documentation View Example Test', async () => {
        // This test opens the documentation view and selects the "Example" link.
        console.log('=================== Documentation View Example Test ===================');

        void vscode.window.showInformationMessage('Running tests: ' + __dirname);
        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
        const mainFile = path.join(testsRoot, 'Main.lean');
        const lean = await initLean4(mainFile);

        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');
        const expectedVersion = 'Hello:';
        let html = await waitForInfoviewHtml(info, expectedVersion);
        const versionString = extractPhrase(html, 'Hello:', '<').trim();
        console.log(`>>> Found "${versionString}" in infoview`)

        await vscode.commands.executeCommand('lean4.docView.open');

        const docView = lean.exports.docView;
        assert(docView, 'No docView export');
        const expectedMenuItem = 'Abbreviations cheat sheet';
        html = await waitForDocViewHtml(docView, expectedMenuItem);

        // invoke the TPIL link
        await invokeHrefCommand(html, 'a[href*="theorem_proving_in_lean4"]');
        html = await waitForDocViewHtml(docView, 'Computers and Theorem Proving');
        await delay(1000); // just so we can see it while debugging

        // go back to menu
        await invokeHrefCommand(html, 'a[href*="lean4.docView.back"]');
        html = await waitForDocViewHtml(docView, expectedMenuItem);
        await delay(1000); // just so we can see it while debugging

        // invoke the command in the <a> tag with href containing 'openExample
        await invokeHrefCommand(html, 'a[href*="openExample"]')

        const example = await waitForActiveEditor('Untitled-1');
        assert(example, 'Example file not opened');

        // the example should be active and should be showing this in the info view.
        const exampleOuput = 'Hello, world!';
        await waitForInfoviewHtml(info, exampleOuput);

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(60000);

}).timeout(60000);
