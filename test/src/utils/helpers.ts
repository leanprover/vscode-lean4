
import * as assert from 'assert';
import * as vscode from 'vscode';
import { InfoProvider } from 'infoview';

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

export async function waitForActiveEditor(retries=10, delay=1000) : Promise<vscode.TextEditor | null> {
    let count = 0;
    console.log('Waiting for active editor...');
    while (!vscode.window.activeTextEditor && count < retries){
        await sleep(delay);
        count += 1;
    }
    const result = (vscode.window.activeTextEditor) ? 'found' : 'not found';
    console.log(`Active editor ${result} found.`);
    return vscode.window.activeTextEditor;
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
