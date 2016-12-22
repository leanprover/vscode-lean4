import {Server} from './server';
import {TextEditor, OutputChannel, TextEditorEdit} from 'vscode';
import {identifierStart} from './util';
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
    // TODO(jroesch): write more robust code for detecting the start of the tactic
    let startPos = identifierStart(editor.document, cursor);
    let fileName = editor.document.fileName;

    server.info(fileName, startPos.line + 1, startPos.character).then((response) => {
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