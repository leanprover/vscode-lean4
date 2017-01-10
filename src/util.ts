import * as vscode from 'vscode';

export function getExecutablePath() {
   let config = vscode.workspace.getConfiguration('lean');
   return config.get('executablePath', "") as string;
}
