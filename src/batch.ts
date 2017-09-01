import {Server} from './server';
import {TextEditor, OutputChannel, TextEditorEdit} from 'vscode';
import * as vscode from 'vscode';
import * as child from 'child_process';
import * as carrier from 'carrier';

let batchOutputChannel : OutputChannel;

export function batchExecuteFile(
    server: Server,
    editor : TextEditor,
    edit : TextEditorEdit,
    args : any[])
{
    batchOutputChannel = batchOutputChannel ||
        vscode.window.createOutputChannel("Lean: Batch File Output");

    let fileName = editor.document.fileName;

    let executablePath = server.executablePath;

    let lean = child.spawn(executablePath, [fileName],
        { cwd: vscode.workspace.rootPath, env: {} /* TODO(gabriel): take from server */ });

    batchOutputChannel.clear();

    carrier.carry(lean.stdout, (line) => {
        batchOutputChannel.appendLine(line);
    });

     carrier.carry(lean.stderr, (line) => {
        batchOutputChannel.appendLine(line);
    });

    lean.on('close', (code) => {
      /* not sure if we need to do anything here */
    });

    batchOutputChannel.show(true);
}
