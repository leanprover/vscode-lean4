import * as assert from 'assert';
import { basename } from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { InfoProvider } from '../../../src/infoview';
import { LeanClient} from '../../../src/leanclient';
import { DocViewProvider } from '../../../src/docview';
import { LeanClientProvider } from '../../../src/utils/clientProvider'
import { Exports } from '../../../src/exports';
import cheerio = require('cheerio');
import path = require('path');
import { logger } from '../../../src/utils/logger'

export function sleep(ms : number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function closeAllEditors(): Thenable<any> {
    return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export function closeActiveEditor(): Thenable<any> {
    return vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

export async function initLean4(fileName: string) : Promise<vscode.Extension<Exports>>{

    await closeAllEditors();
    const options : vscode.TextDocumentShowOptions = { preview: false };

    const doc = await vscode.workspace.openTextDocument(fileName);
    await vscode.window.showTextDocument(doc, options);

    const lean = await waitForActiveExtension('leanprover.lean4', 60);
    assert(lean, 'Lean extension not loaded');
    assert(lean.exports.isLean4Project);
    assert(lean.isActive);
    logger.log(`Found lean package version: ${lean.packageJSON.version}`);
    await waitForActiveEditor(basename(fileName));

    const info = lean.exports.infoProvider;
	assert(info, 'No InfoProvider export');
    assert(await waitForInfoViewOpen(info, 60),
        'Info view did not open after 20 seconds');
    return lean;
}

export async function insertText(text: string) : Promise<void> {
    const editor = vscode.window.activeTextEditor;
    assert(editor !== undefined, 'no active editor');
    await editor.edit((builder) => {
        builder.delete(editor.selection);
        const cursorPos = editor.selection.end;
        builder.insert(cursorPos, text);
        const endInsert = editor.selection.end;
        editor.selection = new vscode.Selection(endInsert, endInsert);
    });
}

export async function deleteAllText() : Promise<void> {
    const editor = vscode.window.activeTextEditor;
    assert(editor !== undefined, 'no active editor');
    await editor.edit((builder) => {
        builder.delete(new vscode.Range(new vscode.Position(0, 0), editor.document.lineAt(editor.document.lineCount-1).range.end));
    })
}

export async function initLean4Untitled(contents: string) : Promise<vscode.Extension<Exports>>{
    // make sure test is always run in predictable state, which is no file or folder open
    await closeAllEditors();

    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');

    const editor = await waitForActiveEditor();
    // make it a lean4 document even though it is empty and untitled.
    logger.log('Setting lean4 language on untitled doc');
    await vscode.languages.setTextDocumentLanguage(editor.document, 'lean4');

    await editor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), contents);
    });

    const lean = await waitForActiveExtension('leanprover.lean4', 60);
    assert(lean, 'Lean extension not loaded');

    logger.log(`Found lean package version: ${lean.packageJSON.version}`);
    const info = lean.exports.infoProvider;
	assert(info, 'No InfoProvider export');

    // If info view opens too quickly there is no LeanClient ready yet and
    // it's initialization gets messed up.
    assert(await waitForInfoViewOpen(info, 60),
        'Info view did not open after 60 seconds');
    return lean;
}

export async function waitForActiveClientRunning(clientProvider: LeanClientProvider | undefined, retries=60, delay=1000){
    let count = 0;
    logger.log('Waiting for active client to enter running state...');
    while (count < retries){
        const client = clientProvider?.getActiveClient();
        if (client && client.isRunning()) {
            return;
        }
        await sleep(delay);
        count += 1;
    }

    assert(false, 'active client is not reaching the running state');
}

export function assertActiveClient(clientProvider: LeanClientProvider | undefined) : LeanClient{
    assert(clientProvider, 'missing LeanClientProvider');
    const client = clientProvider.getActiveClient();
    assert(client, 'Missing active LeanClient');
    return client;
}

export async function resetToolchain(clientProvider: LeanClientProvider | undefined, retries=10, delay=1000) : Promise<void>{

    const client = assertActiveClient(clientProvider);

    let stopped = false;
    let restarted = false;
    client.stopped(() => { stopped = true });
    client.restarted(() => { restarted = true });

    await vscode.commands.executeCommand('lean4.selectToolchain', 'reset');

    // wait a second to see if we've been stopped..
    let count = 0;
    while (count < retries){
        if (stopped) {
            break;
        }
        await sleep(100);
        count += 1;
    }

    if (stopped){
        // then we need to wait for restart.
        count = 0;
        while (count < retries){
            if (restarted) {
                break;
            }
            await sleep(delay);
            count += 1;
        }
    }
}

export async function waitForActiveExtension(extensionId: string, retries=60, delay=1000) : Promise<vscode.Extension<Exports> | null> {

    logger.log(`Waiting for extension ${extensionId} to be loaded...`);
    let lean : vscode.Extension<Exports> | undefined;
    let count = 0;
    while (!lean) {
        vscode.extensions.all.forEach((e) => {
            if (e.id === extensionId){
                lean = e;
                logger.log(`Found extension: ${extensionId}`);
            }
        });
        if (!lean){
            count += 1;
            if (count >= retries){
                return null;
            }
            await sleep(delay);
        }
    }

    logger.log(`Waiting for extension ${extensionId} activation...`);
    count = 0
    while (!lean.isActive && count < retries){
        await sleep(delay);
        count += 1;
    }

    logger.log(`Extension ${extensionId} isActive=${lean.isActive}`);
    return lean;
}

export async function waitForActiveEditor(filename='', retries=60, delay=1000) : Promise<vscode.TextEditor> {
    let count = 0;
    while (!vscode.window.activeTextEditor && count < retries){
        await sleep(delay);
        count += 1;
    }
    let editor = vscode.window.activeTextEditor
    assert(editor, 'Missing active text editor');

    logger.log(`Loaded document ${editor.document.uri}`);

    if (filename) {
        count = 0;
        while (editor && !editor.document.uri.fsPath.toLowerCase().endsWith(filename.toLowerCase()) && count < retries){
            await sleep(delay);
            count += 1;
            editor = vscode.window.activeTextEditor
        }
        assert(editor && editor.document.uri.fsPath.toLowerCase().endsWith(filename.toLowerCase()), `Active text editor does not match ${filename}`);
    }

    return editor;
}

export async function waitForInfoViewOpen(infoView: InfoProvider, retries=60, delay=1000) : Promise<boolean> {
    let count = 0;
    let opened = false;
    logger.log('Waiting for InfoView...');
    while (count < retries){
        const isOpen = infoView.isOpen();
        if (isOpen) {
            logger.log('InfoView is open.');
            return true;
        } else if (!opened) {
            opened = true;
            await vscode.commands.executeCommand('lean4.displayGoal');
        }
        await sleep(delay);
        count += 1;
    }

    logger.log('InfoView not found.');
    return false;
}

export async function waitForInfoviewHtml(infoView: InfoProvider, toFind : string, retries=60, delay=1000, expand=true): Promise<string> {
    let count = 0;
    let html = '';
    while (count < retries){
        html = await infoView.getHtmlContents();
        if (html.indexOf(toFind) > 0){
            return html;
        }
        if (expand && html.indexOf('<details>') >= 0) { // we want '<details open>' instead...
            await infoView.toggleAllMessages();
        }
        await sleep(delay);
        count += 1;
    }

    logger.log(`>>> infoview missing "${toFind}"`);
    logger.log(html);
    assert(false, `Missing "${toFind}" in infoview`);
}

export async function waitForInfoviewNotHtml(infoView: InfoProvider, toFind : string, retries=60, delay=1000, collapse=true): Promise<void> {
    let count = 0;
    let html = '';
    while (count < retries){
        html = await infoView.getHtmlContents();
        if (html.indexOf(toFind) < 0){
            return;
        }
        if (collapse && html.indexOf('<details ') >= 0) { // we want '<details>' instead...(collapsed)
            await infoView.toggleAllMessages();
        }
        await sleep(delay);
        count += 1;
    }

    logger.log(`>>> infoview still contains "${toFind}"`);
    logger.log(html);
    assert(false, `Text "${toFind}" in infoview is not going away`);
}

export async function waitForDocViewHtml(docView: DocViewProvider, toFind : string, retries=60, delay=1000): Promise<string> {
    let count = 0;
    let html = '';
    while (count < retries){
        html = await docView.getHtmlContents();
        if (html.indexOf(toFind) > 0){
            return html;
        }
        await sleep(delay);
        count += 1;
    }

    logger.log('>>> docview contents:')
    logger.log(html);
    assert(false, `Missing "${toFind}" in docview`);
    return html;
}

export function extractPhrase(html: string, word: string, terminator: string){
    const pos = html.indexOf(word);
    if (pos >= 0){
        let endPos = html.indexOf(terminator, pos);
        const eolPos = html.indexOf('\n', pos);
        if (eolPos > 0 && eolPos < endPos){
            endPos = eolPos;
        }
        return html.substring(pos, endPos);
    }
    return '';
}

export async function findWord(editor: vscode.TextEditor, word: string, retries=60, delay=1000) : Promise<vscode.Range> {
    let count = 0;
    while (retries > 0) {
            const text = editor.document.getText();
        const pos = text.indexOf(word);
        if (pos < 0) {
            await sleep(delay);
            count += 1;
        } else {
            return new vscode.Range(editor.document.positionAt(pos), editor.document.positionAt(pos + word.length));
        }
    }

    assert(false, `word ${word} not found in editor`);
}

export async function gotoDefinition(editor: vscode.TextEditor, word: string, retries=60, delay=1000) : Promise<void> {
    const wordRange = await findWord(editor, word, retries, delay);

    // The -1 is to workaround a bug in goto definition.
    // The cursor must be placed before the end of the identifier.
    const secondLastChar = new vscode.Position(wordRange.end.line, wordRange.end.character - 1);
    editor.selection = new vscode.Selection(wordRange.start, secondLastChar);

    await vscode.commands.executeCommand('editor.action.revealDefinition');
}

export async function restartFile() : Promise<void> {
    console.log('restarting file in lean client ...');
    await vscode.commands.executeCommand('lean4.restartFile');
}

export async function restartLeanServer(client: LeanClient, retries=60, delay=1000) : Promise<boolean> {
    let count = 0;
    logger.log('restarting lean client ...');

    const stateChanges : string[] = []
    client.stopped(() => { stateChanges.push('stopped'); });
    client.restarted(() => { stateChanges.push('restarted'); });
    client.serverFailed(() => { stateChanges.push('failed'); });

    await vscode.commands.executeCommand('lean4.restartServer');

    while (count < retries){
        const index = stateChanges.indexOf('restarted');
        if (index >= 0) {
            break;
        }
        await sleep(delay);
        count += 1;
    }

    // check we have no errors.
    if (stateChanges.length === 0){
        assert(false, 'restartServer did not fire any events')
    }
    const actual = stateChanges[stateChanges.length - 1];
    const expected = 'restarted'
    if (actual !== expected) {
        logger.log(`restartServer did not produce expected result: ${actual}`);
    }
    assert(actual === expected);
    return false;
}

export async function assertStringInInfoview(infoView: InfoProvider, expectedVersion: string) : Promise<string> {
    return await waitForInfoviewHtml(infoView, expectedVersion);
}

export async function invokeHrefCommand(html: string, selector: string) : Promise<void> {

    const $ = cheerio.load(html);
    const link = $(selector);
    assert(link, 'openExample link not found')
    if (link) {
        const href = link.attr('href');
        if (href) {
            const prefix = 'command:'
            assert(href.startsWith(prefix), `expecting the href to start with ${prefix}`);
            const cmd = href.slice(prefix.length);
            const uri = vscode.Uri.parse(cmd);
            const query = decodeURIComponent(uri.query);
            logger.log(`Opening file : ${query}`);
            const args = JSON.parse(query);
            let arg : string = ''
            if (Array.isArray(args)){
                arg = args[0]
            } else {
                arg = args
            }
            await vscode.commands.executeCommand(uri.path.slice(1), arg);
        }
    }

}

export async function clickInfoViewButton(info: InfoProvider, name: string) : Promise<void> {
    await assertStringInInfoview(info, name);
    let retries = 5;
    while (retries > 0) {
        retries--;
        try {
            const cmd = `document.querySelector(\'[data-id*="${name}"]\').click()`;
            await info.runTestScript(cmd);
        } catch (err){
            logger.log(`### runTestScript failed: ${err.message}`);
            if (retries === 0){
                throw err;
            }
            logger.log(`### Retrying clickInfoViewButton ${name}...`)
            await sleep(1000);
        }
    }
}

export function mkdirs(fullPath: string){
    const parts = fullPath.split(path.sep);
    // on windows the parts[0] is the drive letter, e.g. "c:"
    // on other platforms parts[0] is empty string, but we want to start with '/'
    let newPath = parts[0];
    parts.splice(0, 1);
    if (!newPath) {
        newPath = '/'
    }
    parts.forEach((p) => {
        newPath = path.join(newPath, p);
        if (newPath && !fs.existsSync(newPath)){
            fs.mkdirSync(newPath);
        }
    });
}

export function copyFolder(source: string, target: string) {
    if (!fs.existsSync(target)){
        mkdirs(target);
    }
    const files = fs.readdirSync(source);
    for(const file of files) {
        const sourceFile = path.join(source, file);
        const targetFile = path.join(target, file);
        const stats = fs.lstatSync(sourceFile);
        if (stats.isFile()) {
            fs.copyFileSync(sourceFile, targetFile);
        }
        else if (stats.isDirectory()){
            copyFolder(sourceFile, targetFile);
        }
    }
}

export function getAltBuildVersion(){
    const testsRoot = path.join(__dirname, '..', '..', '..', '..', 'test');
    const multiFoo = path.join(testsRoot, 'test-fixtures', 'multi', 'foo');
    const toolchain = fs.readFileSync(path.join(multiFoo, 'lean-toolchain'), 'utf8').toString();
    return toolchain.trim().split(':')[1];
}
