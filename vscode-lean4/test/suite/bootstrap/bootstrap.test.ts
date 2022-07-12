import * as assert from 'assert';
import * as os from 'os';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { initLean4Untitled, waitForActiveEditor, waitForInfoviewHtml, closeAllEditors,
         gotoDefinition, assertStringInInfoview, copyFolder } from '../utils/helpers';
import { getDefaultElanPath } from '../../../src/config'
import { batchExecute } from '../../../src/utils/batch'

suite('Lean4 Bootstrap Test Suite', () => {

    test('Install elan on demand', async () => {

        console.log('=================== Install elan on demand ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        // give it a extra long timeout in case test machine is really slow.
		await waitForInfoviewHtml(info, '4.0.0-nightly-', 600);

        // test goto definition to lean toolchain works
        await waitForActiveEditor();
        let editor = vscode.window.activeTextEditor;
        assert(editor !== undefined, 'no active editor');
        await gotoDefinition(editor, 'versionString');

        // check infoview is working in this new editor, it should be showing the expected type
        // for the versionString function we just jumped to.
        const html = await waitForInfoviewHtml(info, 'Expected type');

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
        await closeAllEditors();

    }).timeout(600000); // give it 5 minutes to install lean in case test machine is really slow.

    test('Install stable build on demand', async () => {

        console.log('=================== Install stable build on demand ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

		await waitForInfoviewHtml(info, '4.0.0-nightly-', 60);

        // install table build which is also needed by subsequent tests.
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

        // give it a extra long timeout in case test machine is really slow.
		await waitForInfoviewHtml(info, '4.0.0, commit', 600);
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(600000);

    test('Create linked toolchain named master', async () => {

        console.log('=================== Create linked toolchain named master ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        const elanRoot = getDefaultElanPath()
        const nightly = path.join(elanRoot, '..', 'toolchains', 'leanprover--lean4---nightly')
        const master = path.join(os.tmpdir(), 'lean4', 'toolchains', 'master')
        copyFolder(nightly, master);

        await batchExecute('elan', ['toolchain', 'link', 'master', master], null, undefined);

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');
		await assertStringInInfoview(info, '4.0.0, commit');
		await vscode.commands.executeCommand('lean4.selectToolchain', 'master');
        // sometimes a copy of lean launches more slowly (especially on Windows).
        await waitForInfoviewHtml(info, '4.0.0-nightly-', 300);
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(300000);

}).timeout(60000);
