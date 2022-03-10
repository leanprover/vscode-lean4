import * as assert from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import { initLean4Untitled, assertStringInInfoview, findWord } from '../utils/helpers';
import { InfoProvider } from '../../../src/infoview';

suite('InfoView Test Suite', () => {

	test('Copy to Comment', async () => {

		console.log('=================== Copy to Comment ===================');

		const lean = await initLean4Untitled('#eval Lean.versionString');
		const info = lean.exports.infoProvider as InfoProvider;

		await assertStringInInfoview(info, '4.0.0-nightly-');

        console.log('Clicking copyToComment button in InfoView');
        await info.runTestScript('document.getElementById(\'copyToComment\').click()');

        console.log("Checking editor contains '4.0.0-nightly'")
		const editor = vscode.window.activeTextEditor;
        assert(editor !== undefined, 'no active editor');
        await findWord(editor, '4.0.0-nightly');

        console.log('make sure new text is selected');
        const text = editor.document.getText(editor.selection);
        assert(text.indexOf('4.0.0-nightly') >= 0, 'copyToClipboard did not select the new text');

	}).timeout(60000);

}).timeout(60000);
