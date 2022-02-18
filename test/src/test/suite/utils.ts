import * as vscode from 'vscode';
import { TestApi } from '@lean4/infoview-api';

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

export async function waitForInfoViewOpen(leanApi: TestApi, retries=10, delay=1000) : Promise<boolean> {
    let count = 0;
    console.log('Waiting for InfoView...');
    while (count < retries){
        const isOpen = await leanApi.isInfoViewOpen();
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

export async function waitForHtmlString(leanApi: TestApi, toFind : string, retries=10, delay=1000): Promise<[string,boolean]> {
    let count = 0;
    let html = '';
    while (count < retries){
        await leanApi.copyHtmlToClipboard();
        await sleep(500);
        html = await vscode.env.clipboard.readText();
        if (html.indexOf(toFind) > 0){
            return [html, true];
        }
        if (html.indexOf('<details>')) { // we want '<details open>' instead...
            await leanApi.toggleAllMessages();
        }
        await sleep(delay);
        count += 1;
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