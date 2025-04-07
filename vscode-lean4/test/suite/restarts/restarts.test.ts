import assert from 'assert'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { FileUri } from '../../../src/utils/exturi'
import { logger } from '../../../src/utils/logger'
import { displayNotification } from '../../../src/utils/notifs'
import {
    assertStringInInfoview,
    assertStringInInfoviewAt,
    closeAllEditors,
    deleteAllText,
    extractPhrase,
    initLean4,
    initLean4Untitled,
    insertText,
    insertTextAfter,
    restartFile,
    restartLeanServer,
    waitForActiveClient,
    waitForInfoviewHtml,
} from '../utils/helpers'

// Expects to be launched with folder: ${workspaceFolder}/vscode-lean4/test/suite/simple
suite('Lean Server Restart Test Suite', () => {
    test('Worker crashed and client running - Restarting Lean Server', async () => {
        logger.log(
            '=================== Test worker crashed and client running - Restarting Lean Server ===================',
        )
        displayNotification('Information', 'Running tests: ' + __dirname)

        // add normal values to initialize lean4 file
        const hello = 'Hello World'
        const evalLine = `#eval "${hello}"`
        const features = await initLean4Untitled(evalLine)
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')

        logger.log('make sure language server is up and running.')
        await assertStringInInfoviewAt('#eval', info, hello)

        const clients = features.clientProvider
        assert(clients, 'No LeanClientProvider export')

        logger.log('Insert eval that causes crash.')
        await insertTextAfter(evalLine, '\n\n#eval (unsafeCast 0 : String)')

        const expectedMessage = 'The Lean Server has stopped processing this file'
        await assertStringInInfoview(info, expectedMessage)

        logger.log('restart the server (without modifying the file, so it should crash again)')
        let client = await waitForActiveClient(clients)
        await restartLeanServer(client)

        logger.log('Checking that it crashed again.')
        await assertStringInInfoview(info, expectedMessage)

        logger.log('deleting the problematic string closing active editors and restarting the server')
        await deleteAllText()
        await insertText(`#eval "${hello}"`)
        logger.log('Now invoke the restart server command')
        client = await waitForActiveClient(clients)
        await restartLeanServer(client)

        logger.log('checking that Hello World comes back after restart')
        await assertStringInInfoviewAt('#eval', info, hello)

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(120000)

    test('Worker crashed and client running - Restarting File (Refreshing dependencies)', async () => {
        logger.log(
            '=================== Test worker crashed and client running (Refreshing dependencies) ===================',
        )
        displayNotification('Information', 'Running tests: ' + __dirname)

        // add normal values to initialize lean4 file
        const hello = 'Hello World'
        const evalLine = `#eval "${hello}"`
        const features = await initLean4Untitled(evalLine)
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')

        logger.log('make sure language server is up and running.')
        await assertStringInInfoviewAt('#eval', info, hello)

        const clients = features.clientProvider
        assert(clients, 'No LeanClientProvider export')

        logger.log('Insert eval that causes crash.')
        await insertTextAfter(evalLine, '\n\n#eval (unsafeCast 0 : String)')

        const expectedMessage = 'The Lean Server has stopped processing this file'
        await assertStringInInfoview(info, expectedMessage)

        logger.log('restart the server (without modifying the file, so it should crash again)')
        let client = await waitForActiveClient(clients)
        await restartFile()

        logger.log('Checking that it crashed again.')
        await assertStringInInfoview(info, expectedMessage)

        logger.log('deleting the problematic string closing active editors and restarting the server')
        await deleteAllText()
        await insertText(`#eval "${hello}"`)
        logger.log('Now invoke the restart server command')
        client = await waitForActiveClient(clients)
        await restartFile()

        logger.log('checking that Hello World comes back after restart')
        await assertStringInInfoviewAt('#eval', info, hello)

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(120000)

    test('Restart Server', async () => {
        logger.log('=================== Test Restart Server ===================')
        displayNotification('Information', 'Running tests: ' + __dirname)

        // Test we can restart the lean server
        const simpleRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple')

        // run this code twice to ensure that it still works after a Restart Server
        for (let i = 0; i < 2; i++) {
            const features = await initLean4(path.join(simpleRoot, 'Main.lean'))

            const info = features.infoProvider
            assert(info, 'No InfoProvider export')

            const activeEditor = vscode.window.activeTextEditor
            assert(activeEditor, 'No active text editor')
            const evalLine = '#eval main'
            const startOffset = activeEditor.document.getText().indexOf(evalLine)
            assert(startOffset !== -1, 'Cannot find #eval in Main.lean')
            const endOffset = startOffset + evalLine.length
            const endPos = activeEditor.document.positionAt(endOffset)
            activeEditor.selection = new vscode.Selection(endPos, endPos)

            const expectedVersion = 'Hello:'
            const html = await waitForInfoviewHtml(info, expectedVersion)
            const versionString = extractPhrase(html, 'Hello:', '<').trim()
            logger.log(`>>> Found "${versionString}" in infoview`)

            logger.log('Now invoke the restart server command')
            const clients = features.clientProvider
            assert(clients, 'No LeanClientProvider export')
            const client = clients.getClientForFolder(new FileUri(simpleRoot))
            if (client) {
                await restartLeanServer(client)
            } else {
                assert(false, 'No LeanClient found for folder')
            }

            // make sure test is always run in predictable state, which is no file or folder open
            await closeAllEditors()
        }
    }).timeout(120000)
}).timeout(120000)
