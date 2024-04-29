import * as assert from 'assert'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import { cleanTempFolder, closeAllEditors, initLean4, waitForInfoviewLambda } from '../utils/helpers'

suite('Lean4 Pre-bootstrap Test Suite', () => {
    test('Test user sees the install prompt', async () => {
        logger.log('=================== Test user sees the install prompt ===================')
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        cleanTempFolder('elan')

        // this will wait up to 60 seconds to do full elan lean install, so test machines better
        // be able to do that.
        const projectRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple')
        const features = await initLean4(path.join(projectRoot, 'Main.lean'))
        const info = features.infoProvider
        const expected1 = 'Waiting for Lean server to start...'
        const expected2 = 'nightly' // lean was already installed before this test started!
        assert(info, 'No InfoProvider export')

        // give it a extra long timeout in case test machine is really slow.
        logger.log(expected1)

        const lambda = (s: string) => {
            return s.indexOf(expected1) > 0 || s.indexOf(expected2) > 0
        }

        let html = await waitForInfoviewLambda(info, lambda, 60)

        let retries = 10
        while (html.indexOf(expected1) > 0) {
            const installer = features.installer
            if (!installer?.isPromptVisible()) {
                html = await waitForInfoviewLambda(info, lambda, 10)
                retries--
                if (retries === 0) {
                    logger.log('>>> infoview contains:')
                    logger.log(html)
                    logger.log('>>> end of infoview contents')
                    assert.fail('Infoview is in a weird state')
                }
                logger.log('Continuing...')
            } else {
                logger.log('Great, it is prompting the user!')
                break // great, it is prompting the user
            }
        }

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(600000) // give it 5 minutes to install lean in case test machine is really slow.
})
