import * as carrier from 'carrier';
import * as child from 'child_process';
import { OutputChannel, TextEditor, TextEditorEdit, window, workspace } from 'vscode';
import { Server } from './server';

let batchOutputChannel: OutputChannel;

export function batchExecuteFile(
    server: Server,
    editor: TextEditor,
    edit: TextEditorEdit,
    args: any[]): void {
    batchOutputChannel = batchOutputChannel ||
        window.createOutputChannel('Lean: Batch File Output');

    const fileName = editor.document.fileName;

    const executablePath = server.executablePath;

    const lean = child.spawn(executablePath, [fileName],
        { cwd: workspace.rootPath, env: {} /* TODO(gabriel): take from server */ });

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
