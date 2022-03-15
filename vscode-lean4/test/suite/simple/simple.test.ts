import * as assert from 'assert';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { initLean4Untitled, waitForActiveEditor, waitForHtmlString,
    extractPhrase, gotoDefinition, assertStringInInfoview, initLean4 } from '../utils/helpers';

suite('Lean3 Basics Test Suite', () => {

    test('Untitled Lean File', async () => {

        console.log('=================== Untitled Lean File ===================');

        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        await assertStringInInfoview(info, '4.0.0-nightly-');

        // test goto definition to lean toolchain works
        let editor = vscode.window.activeTextEditor;
        assert(editor !== undefined, 'no active editor');
        await gotoDefinition(editor, 'versionString');

        // check infoview is working in this new editor, it should be showing the expected type
        // for the versionString function we just jumped to.
        await waitForHtmlString(info, 'Expected type');

        const expected = path.join('.elan', 'toolchains', 'leanprover--lean4---nightly', 'src', 'lean');
        editor = vscode.window.activeTextEditor;
        assert(editor !== undefined, 'no active editor');
        assert(editor.document.uri.fsPath.indexOf(expected) > 0,
            `Active text editor is not located in ${expected}`);

        // make sure lean client is started in the right place.
        const clients = lean.exports.clientProvider;
		assert(clients, 'No LeanClientProvider export');
        clients.getClients().forEach((client) => {
            const leanRoot = client.getWorkspaceFolder();
            if (leanRoot.indexOf('leanprover--lean4---nightly') > 0){
                assert(leanRoot.endsWith('leanprover--lean4---nightly'),
                    'Lean client is not rooted in the \'leanprover--lean4---nightly\' folder');
            }
        });

        // make sure test is always run in predictable state, which is no file or folder open
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    }).timeout(60000);

    test('Orphaned Lean File', async () => {

        console.log('=================== Orphaned Lean File ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'orphan');
        const lean = await initLean4(path.join(testsRoot, 'factorial.lean'));

        const expectedVersion = '5040';  // the factorial function works.
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');
        await waitForHtmlString(info, expectedVersion);

        const installer = lean.exports.installer;
        assert(installer, 'No LeanInstaller export');
        const toolChains = await installer.elanListToolChains(null);
        let defaultToolChain = toolChains.find(tc => tc.indexOf('default') > 0);
        if (defaultToolChain) {
            // the IO.appPath should output something like this:
            // FilePath.mk "/home/.elan/toolchains/leanprover--lean4---nightly/bin/lean.exe"
            // So let's try and find the 'leanprover--lean4---nightly' part.
            defaultToolChain = defaultToolChain.replace(' (default)', '').trim();
            defaultToolChain = defaultToolChain.replace('/','--');
            defaultToolChain = defaultToolChain.replace(':','---')
            // make sure this string exists in the info view.
            await waitForHtmlString(info, defaultToolChain);
        }

        // make sure test is always run in predictable state, which is no file or folder open
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    }).timeout(60000);

    test('Goto definition in a package folder', async () => {
        console.log('=================== Goto definition in a package folder ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        // Test we can load file in a project folder from a package folder and also
        // have goto definition work showing that the LeanClient is correctly
        // running in the package root.

        // This test is run twice, once as an ad-hoc mode (no folder open)
        // and again using "open folder" mode.
        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple');
        const lean = await initLean4(path.join(testsRoot, 'Main.lean'));

        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');
        let expectedVersion = 'Hello:';
        let html = await waitForHtmlString(info, expectedVersion);
        const versionString = extractPhrase(html, 'Hello:', '<').trim();
        console.log(`>>> Found "${versionString}" in infoview`)

        const editor = await waitForActiveEditor();
        await gotoDefinition(editor, 'getLeanVersion');

        // if goto definition worked, then we are in Version.lean and we should see the Lake version string.
        expectedVersion = 'Lake Version:';
        html = await waitForHtmlString(info, expectedVersion);

        // make sure test is always run in predictable state, which is no file or folder open
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    }).timeout(60000);

}).timeout(60000);
