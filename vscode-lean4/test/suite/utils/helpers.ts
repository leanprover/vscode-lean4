import assert from 'assert'
import * as fs from 'fs'
import * as os from 'os'
import path, { basename, join } from 'path'
import * as vscode from 'vscode'
import { AlwaysEnabledFeatures, EnabledFeatures, Exports } from '../../../src/exports'
import { InfoProvider } from '../../../src/infoview'
import { LeanClient } from '../../../src/leanclient'
import { LeanClientProvider } from '../../../src/utils/clientProvider'
import { logger } from '../../../src/utils/logger'

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function closeAllEditors(): Thenable<any> {
    return vscode.commands.executeCommand('workbench.action.closeAllEditors')
}

export function closeActiveEditor(): Thenable<any> {
    return vscode.commands.executeCommand('workbench.action.closeActiveEditor')
}

export function assertAndLog(value: unknown, message: string): asserts value {
    if (!value) {
        logger.log(message)
    }
    assert(value, message)
}

export async function initLean4(fileName: string): Promise<EnabledFeatures> {
    await closeAllEditors()
    const options: vscode.TextDocumentShowOptions = { preview: false }

    const lean = await waitForActiveExtension('leanprover.lean4', 60)
    assertAndLog(lean, 'Lean extension not loaded')
    assertAndLog(lean.isActive, 'Lean extension is not active')
    logger.log(`Found lean package version: ${lean.packageJSON.version}`)

    const doc = await vscode.workspace.openTextDocument(fileName)
    await vscode.window.showTextDocument(doc, options)

    await waitForActiveEditor(basename(fileName))
    const features = await waitForLean4FeatureActivation(lean.exports)
    assertAndLog(await waitForActiveInfoProvider(features), 'Info view provider did not load after 60 seconds')
    const info = features.infoProvider
    assertAndLog(info, 'No InfoProvider export')
    assertAndLog(await waitForInfoViewOpen(info, 60), 'Info view did not open after 20 seconds')
    return features
}

export async function initLean4WithoutInstallation(fileName: string): Promise<AlwaysEnabledFeatures> {
    await closeAllEditors()
    const options: vscode.TextDocumentShowOptions = { preview: false }

    const lean = await waitForActiveExtension('leanprover.lean4', 60)
    assertAndLog(lean, 'Lean extension not loaded')
    assertAndLog(lean.isActive, 'Lean extension is not active')
    logger.log(`Found lean package version: ${lean.packageJSON.version}`)

    const doc = await vscode.workspace.openTextDocument(fileName)
    await vscode.window.showTextDocument(doc, options)

    await waitForActiveEditor(basename(fileName))
    return lean.exports.alwaysEnabledFeatures
}

export async function insertText(text: string): Promise<void> {
    const editor = vscode.window.activeTextEditor
    assertAndLog(editor !== undefined, 'no active editor')
    await editor.edit(builder => {
        builder.delete(editor.selection)
        const cursorPos = editor.selection.end
        builder.insert(cursorPos, text)
        const endInsert = editor.selection.end
        editor.selection = new vscode.Selection(endInsert, endInsert)
    })
}

export async function deleteAllText(): Promise<void> {
    const editor = vscode.window.activeTextEditor
    assertAndLog(editor !== undefined, 'no active editor')
    await editor.edit(builder => {
        builder.delete(
            new vscode.Range(
                new vscode.Position(0, 0),
                editor.document.lineAt(editor.document.lineCount - 1).range.end,
            ),
        )
    })
}

export function gotoPosition(searchString: string, after: boolean = false): void {
    const editor = vscode.window.activeTextEditor
    assertAndLog(editor !== undefined, 'no active editor')
    const text = editor.document.getText()
    let offset = text.indexOf(searchString)
    if (after) {
        offset += searchString.length
    }
    const position = editor.document.positionAt(offset)
    editor.selection = new vscode.Selection(position, position)
}

export async function insertTextAfter(searchString: string, text: string): Promise<void> {
    gotoPosition(searchString, true)
    await insertText(text)
}

export async function initLean4Untitled(contents: string): Promise<EnabledFeatures> {
    // make sure test is always run in predictable state, which is no file or folder open
    await closeAllEditors()

    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile')

    const editor = await waitForActiveEditor()
    // make it a lean4 document even though it is empty and untitled.
    logger.log('Setting lean4 language on untitled doc')
    await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4')

    await editor.edit(builder => {
        builder.insert(new vscode.Position(0, 0), contents)
    })

    const lean = await waitForActiveExtension('leanprover.lean4', 60)
    assertAndLog(lean, 'Lean extension not loaded')
    logger.log(`Found lean package version: ${lean.packageJSON.version}`)
    const features = await waitForLean4FeatureActivation(lean.exports)
    const info = features.infoProvider
    assertAndLog(info, 'No InfoProvider export')

    // If info view opens too quickly there is no LeanClient ready yet and
    // it's initialization gets messed up.
    assertAndLog(await waitForInfoViewOpen(info, 60), 'Info view did not open after 60 seconds')
    return features
}

export async function waitForActiveClientRunning(
    clientProvider: LeanClientProvider | undefined,
    retries = 60,
    delay = 1000,
    retryHandler = nullHandler,
) {
    let count = 0
    let tally = 0
    assertAndLog(clientProvider, 'missing LeanClientProvider')
    logger.log('Waiting for active client to enter running state...')
    while (count < retries) {
        const client = clientProvider.getActiveClient()
        if (client && client.isRunning()) {
            return
        }
        await sleep(1000)
        tally += 1000
        if (tally >= delay) {
            count += 1
            tally = 0
            if (retryHandler) {
                retryHandler()
            }
        }
    }

    const timeout = (retries * delay) / 1000
    assertAndLog(false, `active client is not reaching the running state after ${timeout} seconds`)
}

export async function waitForActiveClient(
    clientProvider: LeanClientProvider | undefined,
    retries = 60,
    delay = 1000,
): Promise<LeanClient> {
    let count = 0
    assertAndLog(clientProvider, 'missing LeanClientProvider')
    logger.log('Waiting for active client ...')
    while (count < retries) {
        const client = clientProvider.getActiveClient()
        if (client) {
            return client
        }
        await sleep(delay)
        count += 1
    }

    const timeout = (retries * delay) / 1000
    assertAndLog(false, `Missing active LeanClient after ${timeout} seconds`)
}

export async function waitForActiveExtension(
    extensionId: string,
    retries = 60,
    delay = 1000,
): Promise<vscode.Extension<Exports> | null> {
    logger.log(`Waiting for extension ${extensionId} to be loaded...`)
    let lean: vscode.Extension<Exports> | undefined
    let count = 0
    while (!lean) {
        vscode.extensions.all.forEach(e => {
            if (e.id === extensionId) {
                lean = e
                logger.log(`Found extension: ${extensionId}`)
            }
        })
        if (!lean) {
            count += 1
            if (count >= retries) {
                return null
            }
            await sleep(delay)
        }
    }

    logger.log(`Waiting for extension ${extensionId} activation...`)
    count = 0
    while (!lean.isActive && count < retries) {
        await sleep(delay)
        count += 1
    }

    logger.log(`Extension ${extensionId} isActive=${lean.isActive}`)
    return lean
}

export async function waitForLean4FeatureActivation(exports: Exports, timeout = 60000): Promise<EnabledFeatures> {
    logger.log('Waiting for Lean 4 feature exports of extension to be loaded...')
    const timeoutPromise: Promise<EnabledFeatures | undefined> = new Promise((resolve, _) =>
        setTimeout(() => resolve(undefined), timeout),
    )
    const allFeatures: EnabledFeatures | undefined = await Promise.race([exports.allFeatures(), timeoutPromise])
    assertAndLog(allFeatures, 'Lean 4 features did not activate.')
    logger.log('Lean 4 feature exports loaded.')
    return allFeatures
}

export async function assertLean4FeaturesNotLoaded(exports: Exports) {
    logger.log('Waiting for Lean 4 feature exports of extension to be loaded...')
    const allFeatures: EnabledFeatures | undefined = await new Promise(async (resolve, _) => {
        setTimeout(() => resolve(undefined), 5000)
        await exports.allFeatures()
    })
    assertAndLog(!allFeatures, 'Lean 4 features activated when they should not have been activated.')
    logger.log('Lean 4 features correctly did not load.')
}

export async function waitForActiveEditor(filename = '', retries = 60, delay = 1000): Promise<vscode.TextEditor> {
    let count = 0
    while (!vscode.window.activeTextEditor && count < retries) {
        await sleep(delay)
        count += 1
    }
    let editor = vscode.window.activeTextEditor
    assertAndLog(editor, 'Missing active text editor')

    logger.log(`Loaded document ${editor.document.uri}`)

    if (filename) {
        count = 0
        while (
            editor &&
            !editor.document.uri.fsPath.toLowerCase().endsWith(filename.toLowerCase()) &&
            count < retries
        ) {
            await sleep(delay)
            count += 1
            editor = vscode.window.activeTextEditor
        }
        assertAndLog(
            editor && editor.document.uri.fsPath.toLowerCase().endsWith(filename.toLowerCase()),
            `Active text editor does not match ${filename}`,
        )
    }

    return editor
}

export async function waitForActiveInfoProvider(
    features: EnabledFeatures,
    retries = 60,
    delay = 1000,
): Promise<boolean> {
    logger.log('Waiting for info view provider to be loaded...')

    let count = 0
    while (!features.infoProvider) {
        count += 1
        if (count >= retries) {
            logger.log('Info view provider did not load.')
            return false
        }
        await sleep(delay)
    }

    logger.log('Info view provider loaded.')
    return true
}

export async function waitForInfoViewOpen(infoView: InfoProvider, retries = 60, delay = 1000): Promise<boolean> {
    let count = 0
    let opened = false
    logger.log('Waiting for InfoView...')
    while (count < retries) {
        const isOpen = infoView.isOpen()
        if (isOpen) {
            logger.log('InfoView is open.')
            return true
        } else if (!opened) {
            opened = true
            await vscode.commands.executeCommand('lean4.displayGoal')
        }
        await sleep(delay)
        count += 1
    }

    logger.log('InfoView not found.')
    return false
}

function nullHandler() {
    return
}

export function cleanTempFolder(name: string) {
    const path = join(os.tmpdir(), name)
    if (fs.existsSync(path)) {
        fs.rmdirSync(path, { recursive: true })
    }
}

export async function waitForInfoviewLambda(
    infoView: InfoProvider,
    matchString: (s: string) => boolean,
    retries = 60,
    delay = 1000,
    expand = true,
    retryHandler = nullHandler,
): Promise<string> {
    let count = 0
    let html = ''
    let tally = 0
    while (count < retries) {
        html = await infoView.getHtmlContents()
        if (matchString(html)) {
            return html
        }
        if (expand && html.indexOf('<details>') >= 0) {
            // we want '<details open>' instead...
            await infoView.toggleAllMessages()
        }
        await sleep(1000)
        tally += 1000
        if (tally >= delay) {
            count += 1
            tally = 0
            if (retryHandler) {
                retryHandler()
            }
        }
    }

    return html
}

export async function waitForInfoviewHtml(
    infoView: InfoProvider,
    toFind: string,
    retries = 60,
    delay = 1000,
    expand = true,
    retryHandler = nullHandler,
): Promise<string> {
    const html = await waitForInfoviewLambda(infoView, s => s.indexOf(toFind) > 0, retries, delay, expand, retryHandler)
    if (html.indexOf(toFind) > 0) {
        return html
    }

    const timeout = (retries * delay) / 1000
    logger.log('>>> infoview contains:')
    logger.log(html)
    logger.log('>>> end of infoview contents')

    assertAndLog(false, `Missing "${toFind}" in infoview after ${timeout} seconds`)
}

export async function waitForInfoviewHtmlAt(
    positionSearchString: string,
    infoView: InfoProvider,
    toFind: string,
    retries = 60,
    delay = 1000,
    expand = true,
    retryHandler = nullHandler,
): Promise<string> {
    gotoPosition(positionSearchString)
    return await waitForInfoviewHtml(infoView, toFind, retries, delay, expand, retryHandler)
}

export async function waitForInfoviewNotHtml(
    infoView: InfoProvider,
    toFind: string,
    retries = 60,
    delay = 1000,
    collapse = true,
): Promise<void> {
    let count = 0
    let html = ''
    while (count < retries) {
        html = await infoView.getHtmlContents()
        if (html.indexOf(toFind) < 0) {
            return
        }
        if (collapse && html.indexOf('<details ') >= 0) {
            // we want '<details>' instead...(collapsed)
            await infoView.toggleAllMessages()
        }
        await sleep(delay)
        count += 1
    }

    const timeout = (retries * delay) / 1000
    logger.log('>>> infoview contains:')
    logger.log(html)
    logger.log('>>> end of infoview contents')
    assertAndLog(false, `infoview still contains "${toFind}" after ${timeout} seconds`)
}

export function extractPhrase(html: string, word: string, terminator: string) {
    const pos = html.indexOf(word)
    if (pos >= 0) {
        let endPos = html.indexOf(terminator, pos)
        const eolPos = html.indexOf('\n', pos)
        if (eolPos > 0 && eolPos < endPos) {
            endPos = eolPos
        }
        return html.substring(pos, endPos)
    }
    return ''
}

export async function findWord(
    editor: vscode.TextEditor,
    word: string,
    retries = 60,
    delay = 1000,
): Promise<vscode.Range> {
    let count = 0
    while (retries > 0) {
        const text = editor.document.getText()
        const pos = text.indexOf(word)
        if (pos < 0) {
            await sleep(delay)
            count += 1
        } else {
            return new vscode.Range(editor.document.positionAt(pos), editor.document.positionAt(pos + word.length))
        }
    }

    const timeout = (retries * delay) / 1000
    assertAndLog(false, `word ${word} not found in editor after ${timeout} seconds`)
}

export async function gotoDefinition(
    editor: vscode.TextEditor,
    word: string,
    retries = 60,
    delay = 1000,
): Promise<void> {
    const wordRange = await findWord(editor, word, retries, delay)

    // The -1 is to workaround a bug in goto definition.
    // The cursor must be placed before the end of the identifier.
    const secondLastChar = new vscode.Position(wordRange.end.line, wordRange.end.character - 1)
    editor.selection = new vscode.Selection(wordRange.start, secondLastChar)

    await vscode.commands.executeCommand('editor.action.revealDefinition')
}

export async function restartFile(): Promise<void> {
    console.log('restarting file in lean client ...')
    await vscode.commands.executeCommand('lean4.restartFile')
}

export async function restartLeanServer(client: LeanClient, retries = 60, delay = 1000): Promise<boolean> {
    let count = 0
    logger.log('restarting lean client ...')

    const stateChanges: string[] = []
    client.stopped(() => {
        stateChanges.push('stopped')
    })
    client.restarted(() => {
        stateChanges.push('restarted')
    })
    client.serverFailed(() => {
        stateChanges.push('failed')
    })

    await vscode.commands.executeCommand('lean4.restartServer')

    while (count < retries) {
        const index = stateChanges.indexOf('restarted')
        if (index >= 0) {
            break
        }
        await sleep(delay)
        count += 1
    }

    const timeout = (retries * delay) / 1000

    // check we have no errors.
    assertAndLog(stateChanges.length !== 0, `restartServer did not fire any events after ${timeout} seconds`)
    const actual = stateChanges[stateChanges.length - 1]
    const expected = 'restarted'
    assertAndLog(
        actual === expected,
        `restartServer did not produce expected result "${actual}" after ${timeout} seconds`,
    )
    return false
}

export async function assertStringInInfoview(infoView: InfoProvider, expectedVersion: string): Promise<string> {
    return await waitForInfoviewHtml(infoView, expectedVersion)
}

export async function assertStringInInfoviewAt(
    positionSearchString: string,
    infoView: InfoProvider,
    expectedVersion: string,
): Promise<string> {
    return await waitForInfoviewHtmlAt(positionSearchString, infoView, expectedVersion)
}

export async function clickInfoViewButton(info: InfoProvider, name: string): Promise<void> {
    await assertStringInInfoview(info, name)
    let retries = 5
    while (retries > 0) {
        retries--
        try {
            const cmd = `document.querySelector(\'[data-id*="${name}"]\').click()`
            await info.runTestScript(cmd)
        } catch (err) {
            logger.log(`### runTestScript failed: ${err.message}`)
            if (retries === 0) {
                throw err
            }
            logger.log(`### Retrying clickInfoViewButton ${name}...`)
            await sleep(1000)
        }
    }
}

export function mkdirs(fullPath: string) {
    const parts = fullPath.split(path.sep)
    // on windows the parts[0] is the drive letter, e.g. "c:"
    // on other platforms parts[0] is empty string, but we want to start with '/'
    let newPath = parts[0]
    parts.splice(0, 1)
    if (!newPath) {
        newPath = '/'
    }
    parts.forEach(p => {
        newPath = path.join(newPath, p)
        if (newPath && !fs.existsSync(newPath)) {
            fs.mkdirSync(newPath)
        }
    })
}

export function copyFolder(source: string, target: string) {
    if (!fs.existsSync(target)) {
        mkdirs(target)
    }
    const files = fs.readdirSync(source)
    for (const file of files) {
        const sourceFile = path.join(source, file)
        const targetFile = path.join(target, file)
        const stats = fs.lstatSync(sourceFile)
        if (stats.isFile()) {
            fs.copyFileSync(sourceFile, targetFile)
        } else if (stats.isDirectory()) {
            copyFolder(sourceFile, targetFile)
        }
    }
}

export function getTestLeanVersion() {
    const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test')
    const multiFoo = path.join(testsRoot, 'test-fixtures', 'simple')
    const toolchain = fs.readFileSync(path.join(multiFoo, 'lean-toolchain'), 'utf8').toString()
    return toolchain.trim().split(':')[1]
}

export function getAltBuildVersion() {
    const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test')
    const multiFoo = path.join(testsRoot, 'test-fixtures', 'multi', 'foo')
    const toolchain = fs.readFileSync(path.join(multiFoo, 'lean-toolchain'), 'utf8').toString()
    return toolchain.trim().split(':')[1]
}
