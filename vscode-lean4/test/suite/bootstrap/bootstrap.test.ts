import * as assert from 'assert'
import { suite } from 'mocha'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import {
    cleanTempFolder,
    closeAllEditors,
    getAltBuildVersion,
    getTestLeanVersion,
    initLean4Untitled,
    waitForActiveClient,
    waitForActiveClientRunning,
    waitForInfoviewHtml,
} from '../utils/helpers'

suite('Lean4 Bootstrap Test Suite', () => {
    test('Install elan on demand', async () => {
        logger.log('=================== Install elan on demand ===================')
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        cleanTempFolder('elan')

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const lean = await initLean4Untitled('#eval Lean.versionString')
        const info = lean.exports.infoProvider
        const expected = '4.0.0-nightly-'
        assert(info, 'No InfoProvider export')

        // give it a extra long timeout in case test machine is really slow.
        logger.log('Wait for elan install of Lean nightly build...')
        await waitForActiveClient(lean.exports.clientProvider, 120)
        await waitForActiveClientRunning(lean.exports.clientProvider, 300)

        const hackNeeded = false
        if (hackNeeded) {
            // this is a hack we can do if it turns out this bootstrap test is unreliable.
            // The hack would be covering a product bug, which is why we'd prefer not to use it.
            // if it times out at 600 seconds then waitForInfoviewHtml prints the contents of the InfoView so we can see what happened.
            // await waitForInfoviewHtml(info, expected, 10, 60000, true, async () => {
            //     // 60 seconds elapsed, and infoview is not updating, try and re-edit
            //     // the file to force the LSP to update.
            //     await deleteAllText();
            //     await insertText('#eval Lean.versionString');
            // });
        } else {
            await waitForInfoviewHtml(info, expected, 600)
        }

        logger.log('Lean installation is complete.')

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(600000) // give it 5 minutes to install lean in case test machine is really slow.

    test('Install alternate build on demand', async () => {
        // this must match the 'test/test-fixtures/multi/foo/lean-toolchain'
        const version = getAltBuildVersion()
        const original = getTestLeanVersion()

        assert(
            version !== original,
            'Test is not configured correctly, alternate build version must be different from original build version. ' +
                'Please edit the "test/test-fixtures/multi/foo/lean-toolchain" and "test/test-fixtures/simple/lean-toolchain" files so they point to ' +
                'different Lean versions. The whole point of the test is that we can switch between different version of Lean.',
        )

        logger.log(`=================== Install leanprover/lean4:${version} build on demand ===================`)
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        // Lean is already installed so this should be quick.
        const lean = await initLean4Untitled('#eval Lean.versionString')
        const info = lean.exports.infoProvider
        assert(info, 'No InfoProvider export')

        logger.log('Wait for Lean nightly build server to start...')
        await waitForInfoviewHtml(info, '4.0.0-nightly-', 120)
        logger.log('Lean nightly build server is running.')

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(600000)
}).timeout(60000)
