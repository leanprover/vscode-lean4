import * as vscode from 'vscode';

export function sleep(ms : number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export async function waitForLeanExtension(retries=10, delay=1000) : Promise<vscode.Extension<any> | null> {

    let lean : vscode.Extension<any> | undefined;
    let count = 0;
    while (!lean) {
        vscode.extensions.all.forEach((e) => {
            if (e.id === 'leanprover.lean4'){
                lean = e;
            }
        });
        if (!lean){
            count += 1;
            if (count >= retries){
                return null;
            }
            console.log('waiting for lean extension to be loaded...');
            await sleep(delay);
        }
    }

    while (!lean.isActive){
        console.log('Waiting for Lean extension activation...');
        await sleep(delay);
    }

    return lean;
}

export async function waitForActiveEditor(retries=10, delay=1000) : Promise<vscode.TextEditor | null> {
    let count = 0;
    while (!vscode.window.activeTextEditor && count < retries){
        await sleep(delay);
        count += 1;
    }
    return vscode.window.activeTextEditor;
}

export async function waitForInfoViewOpen(leanApi, retries=10, delay=1000) : Promise<any> {
    let count = 0;
    while (count < retries){
        const info = leanApi.infoProvider;
        if (info && info.isOpen()) {
            const panel = info.getWebView();
            if (panel) {
                return info;
            } else {
                console.log('leanApi.infoProvider.getWebView() returned null');
            }
        } if (!info){
            console.log('leanApi.infoProvider is missing?');
            console.log(JSON.stringify(leanApi));
        } else if (!info.isOpen()){
            console.log('leanApi.infoProvider isOpen returned false');
        }
        await sleep(delay);
        count += 1;
    }
    return null;
}

export async function waitForHtmlString(webView : any, toFind : string, retries=10, delay=1000): Promise<string> {
    let count = 0;
    while (count < retries){
        webView.api.requestedAction({kind: 'copyHtmlToClipboard'});
        await sleep(500);
        const html = await vscode.env.clipboard.readText();
        if (html.indexOf(toFind) > 0){
            return html;
        }
        if (html.indexOf('<details>')) {
            await webView.api.requestedAction({kind: 'toggleAllMessages'});
        }
        await sleep(delay);
        count += 1;
    }

    return '';
}

