import assert from 'assert'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import { displayNotification } from '../../../src/utils/notifs'
import { assertStringInInfoviewAt, closeAllEditors, getAltBuildVersion, initLean4 } from '../utils/helpers'

suite('Multi-Folder Test Suite', () => {
    test('Load a multi-project workspace', async () => {
        logger.log('=================== Load Lean Files in a multi-project workspace ===================')
        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
        displayNotification('Information', 'Running tests: ' + __dirname)

        const multiRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'multi')
        const features = await initLean4(path.join(multiRoot, 'test', 'Main.lean'))

        // verify we have a nightly build running in this folder.
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')
        await assertStringInInfoviewAt('#eval Lean.versionString', info, '4.0.0-nightly-')

        // Now open a file from the other project
        const doc2 = await vscode.workspace.openTextDocument(path.join(multiRoot, 'foo', 'Foo.lean'))
        const version = getAltBuildVersion()
        const options: vscode.TextDocumentShowOptions = { preview: false }
        await vscode.window.showTextDocument(doc2, options)

        logger.log(`wait for version ${version} to load...`)
        await assertStringInInfoviewAt('#eval', info, version)

        // Now verify we have 2 LeanClients running.
        const clients = features.clientProvider
        assert(clients, 'No LeanClientProvider export')
        const actual = clients.getClients().length
        assert(actual === 2, 'Expected 2 LeanClients to be running, but found ' + actual)

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(60000)
}).timeout(60000)
