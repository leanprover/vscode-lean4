import * as assert from 'assert';
import * as os from 'os';
import { suite } from 'mocha';
import * as path from 'path';
import * as vscode from 'vscode';
import { initLean4Untitled, waitForActiveEditor, waitForInfoviewHtml, closeAllEditors,
         gotoDefinition, assertStringInInfoview, copyFolder } from '../utils/helpers';
import { getDefaultElanPath } from '../../../src/config'
import { batchExecute } from '../../../src/utils/batch'
import { logger } from '../../../src/utils/logger'

suite('Lean4 Bootstrap Test Suite', () => {

    test('Install elan on demand', async () => {

        logger.log('=================== Install elan on demand ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        // give it a extra long timeout in case test machine is really slow.
        logger.log('Wait for elan install of Lean nightly build...')
		await waitForInfoviewHtml(info, '4.0.0-nightly-', 600);

        logger.log('Lean installation is complete.')

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(600000); // give it 5 minutes to install lean in case test machine is really slow.

    test('Install stable build on demand', async () => {

        logger.log('=================== Install stable build on demand ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        // Lean is already installed so this should be quick.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        logger.log('Wait for Lean nightly build server to start...')
		await waitForInfoviewHtml(info, '4.0.0-nightly-', 60);
        logger.log('Lean nightly build server is running.')

        // install table build which is also needed by subsequent tests.
        logger.log('Wait for lean stable build to be installed...')
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');

        // give it a extra long timeout in case test machine is really slow.
		await waitForInfoviewHtml(info, '4.0.0, commit', 600);
        logger.log('Lean stable build is running.')
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(600000);

    test('Create linked toolchain named master', async () => {

        logger.log('=================== Create linked toolchain named master ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        logger.log('Create copy of nightly build in a temp master folder...')
        const elanRoot = getDefaultElanPath()
        const nightly = path.join(elanRoot, '..', 'toolchains', 'leanprover--lean4---nightly')
        const master = path.join(os.tmpdir(), 'lean4', 'toolchains', 'master')
        copyFolder(nightly, master);

        logger.log('Use elan to link the master toolchain...')
        await batchExecute('elan', ['toolchain', 'link', 'master', master], null, undefined);

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        logger.log('Wait for stable lean server to start...')
		await vscode.commands.executeCommand('lean4.selectToolchain', 'leanprover/lean4:stable');
		await assertStringInInfoview(info, '4.0.0, commit');
        logger.log('Wait for master lean server to start...')
		await vscode.commands.executeCommand('lean4.selectToolchain', 'master');
        // sometimes a copy of lean launches more slowly (especially on Windows).
        await waitForInfoviewHtml(info, '4.0.0-nightly-', 300);
        logger.log('Linked master toolchain is running.')
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(300000);

}).timeout(60000);
