import * as assert from 'assert';
import { join, sep } from 'path';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import { initLean4Untitled, waitForInfoviewHtml, closeAllEditors, waitForActiveClientRunning, waitForActiveClient,
         getAltBuildVersion, deleteAllText, insertText, cleanTempFolder } from '../utils/helpers';
import { logger } from '../../../src/utils/logger'

suite('Lean4 Bootstrap Test Suite', () => {

    test('Install elan on demand', async () => {

        logger.log('=================== Install elan on demand ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        cleanTempFolder('elan');

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        const  expected = '4.0.0-nightly-';
        assert(info, 'No InfoProvider export');

        // give it a extra long timeout in case test machine is really slow.
        logger.log('Wait for elan install of Lean nightly build...')
        await waitForActiveClient(lean.exports.clientProvider, 120);
        await waitForActiveClientRunning(lean.exports.clientProvider, 120);

        // if it times out at 300 seconds then waitForInfoviewHtml prints the contents of the InfoView so we can see what happened.
		await waitForInfoviewHtml(info, expected, 10, 10000, true, async () => {
            // 60 seconds elapsed, and infoview is not updating, try and re-edit
            // the file to force the LSP to update.
            await deleteAllText();
            await insertText('#eval Lean.versionString');
        });

        logger.log('Lean installation is complete.')

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(600000); // give it 5 minutes to install lean in case test machine is really slow.

    test('Install alternate build on demand', async () => {

        // this must match the 'test/test-fixtures/multi/foo/lean-toolchain'
        // currently should be: leanprover/lean4:nightly-2022-07-03
        const version = getAltBuildVersion()

        logger.log(`=================== Install leanprover/lean4:${version} build on demand ===================`);
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        // Lean is already installed so this should be quick.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        assert(info, 'No InfoProvider export');

        logger.log('Wait for Lean nightly build server to start...')
		await waitForInfoviewHtml(info, '4.0.0-nightly-', 120);
        logger.log('Lean nightly build server is running.')

        // install the alternate build
        logger.log(`Wait for lean4:${version} build to be installed...`)
		await vscode.commands.executeCommand('lean4.selectToolchain', `leanprover/lean4:${version}`);

        // give it a extra long timeout in case test machine is really slow.
		await waitForInfoviewHtml(info, version, 600);
        logger.log(`Lean ${version} build is running.`)
		await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(600000);

}).timeout(60000);
