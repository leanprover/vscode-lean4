import assert from 'assert'
import { suite } from 'mocha'
import * as vscode from 'vscode'
import { logger } from '../../../src/utils/logger'
import {
    assertStringInInfoview,
    assertStringInInfoviewAt,
    clickInfoViewButton,
    closeActiveEditor,
    closeAllEditors,
    gotoDefinition,
    gotoPosition,
    initLean4Untitled,
    insertText,
    insertTextAfter,
    waitForActiveEditor,
    waitForInfoviewHtml,
    waitForInfoviewHtmlAt,
    waitForInfoviewNotHtml,
} from '../utils/helpers'

suite('InfoView Test Suite', () => {
    test('Pinning and unpinning', async () => {
        logger.log('=================== Pinning and unpinning ===================')

        const a = 23
        const b = 95
        const c = 77
        const d = 7

        const evalLine1 = `#eval ${a}*${b}`
        const features = await initLean4Untitled(evalLine1)
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')

        const expectedEval1 = (a * b).toString()
        await assertStringInInfoview(info, expectedEval1)

        logger.log('Pin this info')
        await clickInfoViewButton(info, 'toggle-pinned')

        logger.log('Insert another couple lines and another eval')
        const evalLine2 = `#eval ${c}*${d}`
        await insertTextAfter(evalLine1, `\n\n/- add another unpinned eval -/\n${evalLine2}`)

        logger.log('wait for the new expression to appear')
        const expectedEval2 = (c * d).toString()
        await assertStringInInfoviewAt(evalLine2, info, expectedEval2)

        logger.log('make sure pinned expression is still there')
        await assertStringInInfoview(info, expectedEval1)

        logger.log('Unpin this info')
        await clickInfoViewButton(info, 'toggle-pinned')

        logger.log('Make sure pinned eval is gone, but unpinned eval remains')
        await waitForInfoviewNotHtml(info, expectedEval1)
        await assertStringInInfoviewAt(evalLine2, info, expectedEval2)

        await closeAllEditors()
    }).timeout(60000)

    test('Pin survives interesting edits', async () => {
        logger.log('=================== Pin survives interesting edits ===================')

        const expectedEval = '[1, 2, 3]'

        const features = await initLean4Untitled('#eval [1, 1+1, 1+1+1] \n')
        const editor = await waitForActiveEditor()
        const firstLine = editor.document.lineAt(0).range
        editor.selection = new vscode.Selection(firstLine.end, firstLine.end)

        const info = features.infoProvider
        assert(info, 'No InfoProvider export')
        await waitForInfoviewHtmlAt('#eval', info, expectedEval, 30, 1000, false)

        logger.log('Pin this info')
        await clickInfoViewButton(info, 'toggle-pinned')

        const firstEval = firstLine.start.with(undefined, 5)
        editor.selection = new vscode.Selection(firstLine.start, firstEval)

        await insertText('/- add\nsome\nfun\ncomments-/\n#eval List.append [4] ')
        const lastLine = editor.document.lineAt(5).range
        editor.selection = new vscode.Selection(lastLine.start, lastLine.start)

        logger.log('wait for the new expression to appear')
        const expectedEval2 = '[4, 1, 2, 3]'
        await waitForInfoviewHtmlAt('#eval', info, expectedEval2, 30, 1000, false)

        logger.log('make sure pinned expression is not showing an error')
        await waitForInfoviewNotHtml(info, 'Incorrect position')

        await vscode.commands.executeCommand('undo')
        const newLastLine = editor.document.lineAt(1).range
        editor.selection = new vscode.Selection(newLastLine.start, newLastLine.start)

        logger.log('make sure pinned value reverts after an undo')
        await waitForInfoviewHtmlAt('#eval', info, expectedEval, 30, 1000, false)

        await closeAllEditors()
    }).timeout(60000)

    test('Pin survives file close', async () => {
        logger.log('=================== Pin survives file close ===================')

        const a = 23
        const b = 95
        const prefix = 'Lean version is:'

        const evalLine = `#eval ${a}*${b}`
        const features = await initLean4Untitled(evalLine)
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')

        const expectedEval = (a * b).toString()
        await assertStringInInfoviewAt('#eval', info, expectedEval)

        logger.log('Pin this info')
        await clickInfoViewButton(info, 'toggle-pinned')

        logger.log('Insert another eval')
        await insertTextAfter(evalLine, '\n\n#eval s!"' + prefix + ': {Lean.versionString}"')

        logger.log('make sure output of versionString is also there')
        await assertStringInInfoviewAt('#eval s!', info, prefix)

        logger.log('make sure pinned expression is not showing an error')
        await waitForInfoviewNotHtml(info, 'Incorrect position')

        logger.log('and make sure pinned value is still there')
        await assertStringInInfoview(info, expectedEval)

        logger.log('Goto definition on versionString')
        let editor = await waitForActiveEditor()

        await gotoDefinition(editor, 'versionString')
        editor = await waitForActiveEditor('Meta.lean')

        logger.log('make sure pinned expression is still there')
        await assertStringInInfoview(info, expectedEval)

        logger.log('Close meta.lean')
        await closeActiveEditor()
        editor = await waitForActiveEditor('Untitled-1')

        logger.log('make sure pinned expression is still there')
        await assertStringInInfoview(info, expectedEval)

        await closeAllEditors()
    }).timeout(60000)

    test('Tooltip exists', async () => {
        logger.log('=================== Clicking to open nested tooltips ===================')

        const text = 'example (issue461 : Type 4) : issue461 := by sorry'
        const features = await initLean4Untitled(text)
        const info = features.infoProvider
        assert(info, 'No InfoProvider export')

        gotoPosition('by')
        await assertStringInInfoview(info, 'issue461')

        logger.log('Opening tooltip for goal type')
        await info.runTestScript(`
          Array.from(document.querySelectorAll('[data-is-goal] *'))
            .find(el => el.innerHTML === 'issue461')
            .click()
        `)
        await waitForInfoviewHtml(info, 'tooltip-content', 30, 1000, false)

        logger.log('Opening tooltip in tooltip')
        await info.runTestScript(`
          Array.from(document.querySelectorAll('.tooltip-content *[data-has-tooltip-on-hover]'))
            .find(el => el.innerHTML === 'Type 4')
            .click()
        `)
        await assertStringInInfoview(info, 'Type 5')

        logger.log('Opening tooltip in tooltip in tooltip')
        await info.runTestScript(`
          Array.from(document.querySelectorAll('.tooltip-content *[data-has-tooltip-on-hover]'))
            .find(el => el.innerHTML === 'Type 5')
            .click()
        `)
        await assertStringInInfoview(info, 'Type 6')

        await closeAllEditors()
    }).timeout(60000)
}).timeout(60000)
