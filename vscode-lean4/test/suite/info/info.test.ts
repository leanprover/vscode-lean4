import * as assert from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import { initLean4Untitled, assertStringInInfoview, findWord, insertText, closeActiveEditor,
    waitForInfoviewNotHtml, waitForActiveEditor, gotoDefinition, closeAllEditors, sleep } from '../utils/helpers';

suite('InfoView Test Suite', () => {

    test('Copy to Comment', async () => {

        console.log('=================== Copy to Comment ===================');

        const a = 37;
        const b = 22;
        const expectedEval1 = (a * b).toString();

        const lean = await initLean4Untitled(`#eval ${a}*${b}`);
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        await assertStringInInfoview(info, expectedEval1);

        console.log('Clicking copyToComment button in InfoView');
        await info.runTestScript('document.querySelector(\'[data-id*="copy-to-comment"]\').click()');

        console.log(`Checking editor contains ${expectedEval1}`)
        const editor = vscode.window.activeTextEditor;
        assert(editor !== undefined, 'no active editor');
        await findWord(editor, expectedEval1);

        await closeAllEditors();

    }).timeout(60000);

    test('Pinning and unpinning', async () => {

        console.log('=================== Pinning and unpinning ===================');

        const a = 23;
        const b = 95;
        const c = 77;
        const d = 7;

        const lean = await initLean4Untitled(`#eval ${a}*${b}`);
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        const expectedEval1 = (a * b).toString()
        await assertStringInInfoview(info, expectedEval1);

        console.log('Pin this info');
        await info.runTestScript('document.querySelector(\'[data-id*="toggle-pinned"]\').click()');

        console.log('Insert another couple lines and another eval')
        await insertText(`\n\n/- add another unpinned eval -/\n#eval ${c}*${d}`)

        console.log('wait for the new expression to appear')
        const expectedEval2 = (c * d).toString()
        await assertStringInInfoview(info, expectedEval2);

        console.log('make sure pinned expression is still there');
        await assertStringInInfoview(info, expectedEval1);

        console.log('Unpin this info');
        await info.runTestScript('document.querySelector(\'[data-id*="toggle-pinned"]\').click()');

        console.log('Make sure pinned eval is gone, but unpinned eval remains')
        await waitForInfoviewNotHtml(info, expectedEval1);
        await assertStringInInfoview(info, expectedEval2);

        await closeAllEditors();
    }).timeout(60000);

    test('Pin survives file close', async () => {

        console.log('=================== Pin survives file close ===================');

        const a = 23;
        const b = 95;
        const prefix = 'Lean version is:'

        const lean =  await initLean4Untitled(`#eval ${a}*${b}` +
            '\n\n#eval s!"' + prefix + ': {Lean.versionString}"');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        console.log('move cursor to end of first line')
        let editor = await waitForActiveEditor();
        const firstLine = editor.document.lineAt(0).range
        editor.selection = new vscode.Selection(firstLine.end, firstLine.end);

        const expectedEval = (a * b).toString()
        await assertStringInInfoview(info, expectedEval);

        console.log('make sure output of versionString is also there');
        await assertStringInInfoview(info, prefix);

        //await sleep(1000)

        console.log('Pin this info');
        await info.runTestScript('document.querySelector(\'[data-id*="toggle-pinned"]\').click()');

        //await sleep(1000)

        console.log('Goto definition on versionString')
        editor = await waitForActiveEditor();
        await gotoDefinition(editor, 'versionString');
        editor = await waitForActiveEditor('Meta.lean');

        //await sleep(1000)

        console.log('make sure pinned expression is still there');
        await assertStringInInfoview(info, expectedEval);

        console.log('Close meta.lean');
        await closeActiveEditor();
        editor = await waitForActiveEditor('Untitled-1');

        console.log('make sure pinned expression is still there');
        await assertStringInInfoview(info, expectedEval);

        await closeAllEditors();
    }).timeout(60000);
}).timeout(60000);
