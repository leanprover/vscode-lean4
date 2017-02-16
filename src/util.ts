import * as vscode from 'vscode';
import * as fs from 'fs';

export function getExecutablePath() : string {
   let config = vscode.workspace.getConfiguration('lean');
   let executablePath = config.get('executablePath') as string;
   if (executablePath !== "lean")
       fs.accessSync(executablePath, fs.constants.F_OK);
   return executablePath;
}

export function getMemoryLimit() : number {
   let config = vscode.workspace.getConfiguration('lean');
   let memoryLimit = config.get('memoryLimit') as number;
   return memoryLimit;
}

export function getTimeLimit() : number {
   let config = vscode.workspace.getConfiguration('lean');
   let timeLimit = config.get('timeLimit') as number;
   return timeLimit;
}

export function isInputCompletion(document : vscode.TextDocument, position : vscode.Position) : boolean {
    let text = document.getText();
    let offset = document.offsetAt(position);
    do { offset--; } while (/[^\\\s]/.test(text.charAt(offset)));
    return text.charAt(offset) === '\\';
}
