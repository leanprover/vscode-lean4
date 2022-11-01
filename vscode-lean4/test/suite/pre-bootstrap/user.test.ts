import * as assert from 'assert';
import { suite } from 'mocha';
import * as vscode from 'vscode';
import { initLean4Untitled, waitForInfoviewHtml, closeAllEditors, cleanTempFolder, waitForActiveClient,} from '../utils/helpers';
import { logger } from '../../../src/utils/logger'

suite('Lean4 Pre-bootstrap Test Suite', () => {

    test('Test user sees the install prompt', async () => {

        logger.log('=================== Test user sees the install prompt ===================');
        void vscode.window.showInformationMessage('Running tests: ' + __dirname);

        cleanTempFolder('elan');

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString');
        const info = lean.exports.infoProvider;
        const  expected = 'Waiting for Lean server to start...';
        assert(info, 'No InfoProvider export');

        // give it a extra long timeout in case test machine is really slow.
        logger.log(expected)

        await waitForInfoviewHtml(info, expected, 600);

        const installer = lean.exports.installer;
        assert(installer?.getActivePrompt())

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors();

    }).timeout(600000); // give it 5 minutes to install lean in case test machine is really slow.

});
