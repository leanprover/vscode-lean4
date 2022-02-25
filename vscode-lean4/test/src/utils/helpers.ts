
import * as assert from 'assert';
import { privateEncrypt } from 'crypto';
import * as vscode from 'vscode';
import { InfoProvider } from '../../../src/infoview';
import { LeanClient} from '../../../src/leanclient';

export function sleep(ms : number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export async function waitForActiveExtension(extensionId: string, retries=10, delay=1000) : Promise<vscode.Extension<any> | null> {

    console.log(`Waiting for extension ${extensionId} to be loaded...`);
    let lean : vscode.Extension<any> | undefined;
    let count = 0;
    while (!lean) {
        vscode.extensions.all.forEach((e) => {
            if (e.id === extensionId){
                lean = e;
                console.log(`Found extension: ${extensionId}`);
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

    console.log(`Waiting for extension ${extensionId} activation...`);
    count = 0
    while (!lean.isActive && count < retries){
        await sleep(delay);
        count += 1;
    }

    console.log(`Extension ${extensionId} isActive=${lean.isActive}`);
    return lean;
}

export async function waitForActiveEditor(filename='', retries=10, delay=1000) : Promise<vscode.TextEditor> {
    let count = 0;
    while (!vscode.window.activeTextEditor && count < retries){
        await sleep(delay);
        count += 1;
    }
    const editor = vscode.window.activeTextEditor
    assert(editor, 'Missing active text editor');

    console.log(`Loaded document ${editor.document.uri}`);

    if (filename) {
        count = 0;
        while (!editor.document.uri.fsPath.endsWith(filename) && count < retries){
            await sleep(delay);
            count += 1;
        }
        assert(editor.document.uri.fsPath.endsWith(filename), `Active text editor does not match ${filename}`);
    }

    return editor;
}

export async function waitForInfoViewOpen(infoView: InfoProvider, retries=10, delay=1000) : Promise<boolean> {
    let count = 0;
    console.log('Waiting for InfoView...');
    while (count < retries){
        const isOpen = await infoView.isOpen();
        if (isOpen) {
            console.log('InfoView is open.');
            return true;
        }
        await sleep(delay);
        count += 1;
    }

    console.log('InfoView not found.');
    return false;
}

export async function waitForHtmlString(infoView: InfoProvider, toFind : string, retries=10, delay=1000): Promise<[string,boolean]> {
    let count = 0;
    let html = '';
    while (count < retries){
        html = await infoView.getHtmlContents();
        if (html.indexOf(toFind) > 0){
            return [html, true];
        }
        if (html.indexOf('<details>')) { // we want '<details open>' instead...
            await infoView.toggleAllMessages();
        }
        await sleep(delay);
        count += 1;
    }

    if (!html) {
        console.log('>>> infoview contents:')
        console.log(html);
        assert(false, `Missing "${toFind}" in infoview`)
    }
    return [html, false];
}

export function extractToTerminator(html: string, pos: number, terminator: string){
	const endPos = html.indexOf(terminator, pos);
	if (endPos < 0) {
		return ''
	}
	return html.substring(pos, endPos);
}

export function findWord(editor: vscode.TextEditor, word: string) : vscode.Range | undefined {
    const text = editor.document.getText();
    const pos = text.indexOf(word);
    if (pos < 0) {
        return undefined;
    }
    return new vscode.Range(editor.document.positionAt(pos), editor.document.positionAt(pos + word.length));
}

export async function restartLeanServer(client: LeanClient, retries=10, delay=1000) : Promise<boolean> {
    let count = 0;
    console.log('restarting lean client ...');

    let stateChanges : string[] = []
    client.stopped(() => { stateChanges.push('stopped'); });
    client.restarted(() => { stateChanges.push('restarted'); });
    client.serverFailed(() => { stateChanges.push('failed'); });

    await vscode.commands.executeCommand('lean4.restartServer');

    while (count < retries){
        const index = stateChanges.indexOf('restarted');
        if (index > 0) {
            break;
        }
        await sleep(delay);
        count += 1;
    }

    // check we have no errors.
    const actual = stateChanges.toString();
    assert(actual === 'stopped,restarted');
    return false;
}
