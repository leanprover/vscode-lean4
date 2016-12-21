import {Server} from './server';
import {TextEditor, OutputChannel, TextEditorEdit} from 'vscode';
import * as vscode from 'vscode';

let outputChannel : OutputChannel;

export function displayGoalAtPosition(
    server : Server,
    editor : TextEditor,
    edit : TextEditorEdit,
    args : any[])
{
    outputChannel = outputChannel || vscode.window.createOutputChannel("Lean: Proof Context");

    let cursor = editor.selection.active;
    let fileName = editor.document.fileName;

    server.info(fileName, cursor.line + 1, cursor.character).then((response) => {
        if (response.record && response.record.state) {
            outputChannel.clear();
            outputChannel.appendLine(response.record.state);
            // Ensure we perserve focus.
            outputChannel.show(true)
        } else {
            return null;
        }
    });
}