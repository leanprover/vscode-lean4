import * as vscode from 'vscode';
import * as fs from 'fs';

export function getExecutablePath() : string {
   let config = vscode.workspace.getConfiguration('lean');
   let executablePath = config.get('executablePath', "") as string;
   let stats = fs.accessSync(executablePath, fs.constants.F_OK);
   return executablePath;
}
