'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Server } from './server';
import { LeanHoverProvider } from './hover';
import { LeanCompletionItemProvider } from './completion';

const LEAN_MODE : vscode.DocumentFilter = {
    language: "lean",
    scheme: 'file'
}

let diagnosticCollection: vscode.DiagnosticCollection;

function toSeverity(lean_severity : string) : vscode.DiagnosticSeverity {
    if (lean_severity == 'warning') {
        return vscode.DiagnosticSeverity.Warning;
    } else if (lean_severity == 'error') {
        return vscode.DiagnosticSeverity.Error;
    } else {
        throw "unknown severity";
    }
}

function updateDiagnostics(collection : vscode.DiagnosticCollection, messages : any) {
    let diagnosticMap : Map<string, vscode.Diagnostic[]> = new Map();
    messages.forEach((message) => {
        let file = vscode.Uri.file(message.file_name);
        let range = new vscode.Range(message.pos_line - 1, message.pos_col, message.pos_line - 1, message.pos_col);
        let diagnostics = diagnosticMap.get(file.toString());
        if (!diagnostics) { diagnostics = []; }
        diagnostics.push(new vscode.Diagnostic(range, message.text, toSeverity(message.severity)));
        diagnosticMap.set(file.toString(), diagnostics);
    });

    diagnosticMap.forEach((diags, file) => {
        diagnosticCollection.set(vscode.Uri.parse(file), diags);
    });
}

export function activate(context: vscode.ExtensionContext) {
    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('extension.sayHello', () => {
        // The code you place here will be executed every time your command is executed

        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World!');
    });

    context.subscriptions.push(disposable);

    let working_directory = vscode.workspace.rootPath;
    console.log("Starting server in " + working_directory);

    let server = new Server('', working_directory);

    // Have the server update diagnostics when we
    // receive new messages.    
    server.onMessage((messages) => {
        diagnosticCollection.clear();
        updateDiagnostics(diagnosticCollection, messages);
    });

    // Register the support for diagnostics.
    diagnosticCollection = vscode.languages.createDiagnosticCollection('lean');
    context.subscriptions.push(diagnosticCollection);

    // Register the support for hovering.
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(LEAN_MODE,
            new LeanHoverProvider(server)));
    
    // Register support for completetion.
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            LEAN_MODE, new LeanCompletionItemProvider(server), '.'));

    // Send a sync message when the editor changes.
    vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === "lean") {
            let file_name = event.document.fileName;
            let contents = event.document.getText();
            server.sync(file_name, contents);
        }
    });
}

// this method is called when your extension is deactivated
export function deactivate() {
}