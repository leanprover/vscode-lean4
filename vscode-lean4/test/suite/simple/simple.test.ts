import * as assert from 'assert'
import { suite } from 'mocha'
import * as path from 'path'
import * as vscode from 'vscode'
import { isElanDisabled } from '../../../src/config'
import { UntitledUri } from '../../../src/utils/exturi'
import { logger } from '../../../src/utils/logger'
import {
    assertStringInInfoview,
    closeAllEditors,
    extractPhrase,
    gotoDefinition,
    initLean4,
    initLean4Untitled,
    waitForActiveEditor,
    waitForInfoviewHtml,
} from '../utils/helpers'

function getElanMode() {
    let mode = ''
    if (isElanDisabled()) {
        mode = ' no elan '
    }
    return mode
}

suite('Lean4 Basics Test Suite', () => {
    test('Untitled Lean File', async () => {
        logger.log(`=================== Untitled Lean File ${getElanMode()} ===================`)
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        const lean = await initLean4Untitled('#eval Lean.versionString')
        const info = lean.exports.infoProvider
        assert(info, 'No InfoProvider export')

        await assertStringInInfoview(info, '4.0.0-nightly-')

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
        logger.log(`=================== Orphaned Lean File ${getElanMode()} ===================`)
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'orphan')
        const lean = await initLean4(path.join(testsRoot, 'factorial.lean'))

        const info = lean.exports.infoProvider
        assert(info, 'No InfoProvider export')
        const expectedVersion = '5040' // the factorial function works.
        const html = await waitForInfoviewHtml(info, expectedVersion)

        const installer = lean.exports.installer
        assert(installer, 'No LeanInstaller export')
        const toolChains = await installer.elanListToolChains(new UntitledUri())
        let defaultToolChain = toolChains.find(tc => tc.indexOf('default') > 0)
        if (defaultToolChain) {
            // the IO.appPath should output something like this:
            // FilePath.mk "/home/.elan/toolchains/leanprover--lean4---nightly/bin/lean.exe"
            // So let's try and find the 'leanprover--lean4---nightly' part.
            defaultToolChain = defaultToolChain.replace(' (default)', '').trim()
            defaultToolChain = defaultToolChain.replace('/', '--')
            defaultToolChain = defaultToolChain.replace(':', '---')
            // make sure this string exists in the info view.
            await waitForInfoviewHtml(info, defaultToolChain)
        }

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(60000)

    test('Goto definition in a package folder', async () => {
        logger.log(`=================== Goto definition in a package folder  ${getElanMode()} ===================`)
        void vscode.window.showInformationMessage('Running tests: ' + __dirname)

        // Test we can load file in a project folder from a package folder and also
        // have goto definition work showing that the LeanClient is correctly
        // running in the package root.

        // This test is run twice, once as an ad-hoc mode (no folder open)
        // and again using "open folder" mode.

        const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test', 'test-fixtures', 'simple')
        const lean = await initLean4(path.join(testsRoot, 'Main.lean'))

        const info = lean.exports.infoProvider
        assert(info, 'No InfoProvider export')
        let expectedVersion = 'Hello:'
        let html = await waitForInfoviewHtml(info, expectedVersion)
        const versionString = extractPhrase(html, 'Hello:', '<').trim()
        logger.log(`>>> Found "${versionString}" in infoview`)

        const editor = await waitForActiveEditor()
        await gotoDefinition(editor, 'getLeanVersion')

        // if goto definition worked, then we are in Version.lean and we should see the Lake version string.
        expectedVersion = 'Lake Version:'
        html = await waitForInfoviewHtml(info, expectedVersion)

        // make sure test is always run in predictable state, which is no file or folder open
        await closeAllEditors()
    }).timeout(60000)
}).timeout(60000)
