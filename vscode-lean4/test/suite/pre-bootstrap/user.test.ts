import * as assert from 'assert'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import { cleanTempFolder, closeAllEditors, initLean4WithoutInstallation, sleep } from '../utils/helpers'

suite('Lean4 Pre-bootstrap Test Suite', () => {
    test('Test user sees the install prompt', async () => {
        logger.log('=================== Test user sees the install prompt ===================')
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        cleanTempFolder('elan')

        const projectRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple')
        const features = await initLean4WithoutInstallation(path.join(projectRoot, 'Main.lean'))

        let retries = 60
        while (retries > 0) {
            const installer = features.installer
            if (!installer?.isPromptVisible()) {
                await sleep(1000)
                retries--
            } else {
                logger.log('Installation prompt appeared.')
                break // great, it is prompting the user
            }
        }

        if (retries === 0) {
            assert.fail('Installation prompt did not show up')
        }

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(600000)
})
