import * as vscode from 'vscode';

export function sleep(ms : number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export async function waitForLeanExtension(retries=10, delay=500) : Promise<vscode.Extension<any> | null> {

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
            console.log("waiting for lean extension to be loaded...");
            await sleep(delay);
        }
    }

    while (!lean.isActive){
        console.log("Waiting for Lean extension activation...");
        await sleep(500);
    }

    return lean;
}

export async function waitForActiveEditor(retries=10, delay=500) : Promise<vscode.TextEditor | null> {
    let count = 0;
    while (!vscode.window.activeTextEditor && count < retries){
        await sleep(500);
        count += 1;
    }
    return vscode.window.activeTextEditor;
}