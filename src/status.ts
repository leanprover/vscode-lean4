import * as vscode from 'vscode';

export function createLeanStatusBarItem() : vscode.StatusBarItem {
    let statusBarItem = vscode.window.createStatusBarItem();

    statusBarItem.text = "$(x)";
    statusBarItem.show();

    return statusBarItem;
}
