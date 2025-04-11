import assert from 'assert'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { elanInstalledToolchains } from '../../../src/utils/elan'
import { logger } from '../../../src/utils/logger'
import { displayNotification } from '../../../src/utils/notifs'
import {
    assertStringInInfoviewAt,
    closeAllEditors,
    extractPhrase,
    gotoDefinition,
    initLean4,
    initLean4Untitled,
    waitForActiveEditor,
    waitForInfoviewHtml,
    waitForInfoviewHtmlAt,
} from '../utils/helpers'

suite('Lean4 Basics Test Suite', () => {
    test('Untitled Lean File', async () => {
        logger.log('=================== Untitled Lean File ===================')
        displayNotification('Information', 'Running tests: ' + __dirname)

        const features = await initLean4Untitled('#eval Lean.versionString')
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')

        await assertStringInInfoviewAt('#eval', info, '4.0.0-nightly-')

        // test goto definition to lean toolchain works
        await waitForActiveEditor()
        let editor = vscode.window.activeTextEditor
        assert(editor !== undefined, 'no active editor')
        await gotoDefinition(editor, 'versionString')

        // check infoview is working in this new editor, it should be showing the expected type
        // for the versionString function we just jumped to.
        const html = await waitForInfoviewHtml(info, 'Expected type')

        editor = vscode.window.activeTextEditor
        assert(editor !== undefined, 'no active editor')
        const actual = editor.document.uri.fsPath.replaceAll('\\', '/')
        const expected = /\.elan\/toolchains\/.*\/src\/lean/
        if (!expected.test(actual)) {
            console.log('Path does not match')
        }
        assert(expected.test(actual), `Active text editor is not located in ${expected}`)

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(60000)

    test('Orphaned Lean File', async () => {
        logger.log('=================== Orphaned Lean File ===================')
        displayNotification('Information', 'Running tests: ' + __dirname)

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'orphan')
        const features = await initLean4(path.join(testsRoot, 'factorial.lean'))

        const info = features.infoProvider
        assert(info, 'No InfoProvider export')
        const expectedVersion = '5040' // the factorial function works.
        const html = await waitForInfoviewHtmlAt('#eval factorial 7', info, expectedVersion)

        const installer = features.installer
        assert(installer, 'No LeanInstaller export')
        const defaultToolchainResult = await elanInstalledToolchains()
        if (defaultToolchainResult.kind === 'Success' && defaultToolchainResult.defaultToolchain !== undefined) {
            let defaultToolchain = defaultToolchainResult.defaultToolchain
            // the IO.appPath should output something like this:
            // FilePath.mk "/home/.elan/toolchains/leanprover--lean4---nightly/bin/lean.exe"
            // So let's try and find the 'leanprover--lean4---nightly' part.
            defaultToolchain = defaultToolchain.replace('/', '--')
            defaultToolchain = defaultToolchain.replace(':', '---')
            // make sure this string exists in the info view.
            await waitForInfoviewHtmlAt('#eval IO.appPath', info, defaultToolchain)
        }

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(60000)

    test('Goto definition in a package folder', async () => {
        logger.log('=================== Goto definition in a package folder ===================')
        displayNotification('Information', 'Running tests: ' + __dirname)

        // Test we can load file in a project folder from a package folder and also
        // have goto definition work showing that the LeanClient is correctly
        // running in the package root.

        // This test is run twice, once as an ad-hoc mode (no folder open)
        // and again using "open folder" mode.

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple')
        const features = await initLean4(path.join(testsRoot, 'Main.lean'))

        const info = features.infoProvider
        assert(info, 'No InfoProvider export')
        let expectedVersion = 'Hello:'
        let html = await waitForInfoviewHtmlAt('#eval main', info, expectedVersion)
        const versionString = extractPhrase(html, 'Hello:', '<').trim()
        logger.log(`>>> Found "${versionString}" in infoview`)

        const editor = await waitForActiveEditor()
        await gotoDefinition(editor, 'getLeanVersion')

        // if goto definition worked, then we are in Version.lean and we should see the Lake version string.
        expectedVersion = 'Lake Version:'
        html = await waitForInfoviewHtmlAt('#eval s!"Lake', info, expectedVersion)

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(60000)
}).timeout(60000)
