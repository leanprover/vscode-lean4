// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Server } from './server';
import { LeanHoverProvider } from './hover';
import { LeanCompletionItemProvider } from './completion';
import { LeanDefinitionProvider } from './definition'
import { displayGoalAtPosition } from './goal';

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
    } else if (lean_severity == 'information') {
        return vscode.DiagnosticSeverity.Information;
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

type SyncEvent =
  vscode.TextDocument |
  vscode.TextDocumentChangeEvent;

function isChangeEvent(e : SyncEvent) : e is vscode.TextDocumentChangeEvent {
    return (e as vscode.TextDocumentChangeEvent).document !== undefined;
}

let server : Server;

export function activate(context: vscode.ExtensionContext) {
    let working_directory = vscode.workspace.rootPath;
    let config = vscode.workspace.getConfiguration('lean')
    let executablePath = config.get('executablePath') as string;

    console.log("Starting server " + executablePath + " in " + working_directory)

    server = new Server(executablePath, working_directory);

    // Ensure that the server is disposed of.
    context.subscriptions.push(server);

    // Setup the commands.
    let restartDisposable = vscode.commands.registerCommand('lean.restartServer', () => {
        server.restart(vscode.workspace.rootPath);
    });

    let goalDisposable = vscode.commands.registerTextEditorCommand(
        'lean.displayGoal',
        (editor, edit, args) => { displayGoalAtPosition(server, editor, edit, args) });

    // Register their disposable as well.
    context.subscriptions.push(restartDisposable);
    context.subscriptions.push(goalDisposable);

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

    // Register support for definitions
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            LEAN_MODE, new LeanDefinitionProvider(server)));

    let syncLeanFiles = (event : SyncEvent) => {
        let document;

        if (isChangeEvent(event)) {
            document = event.document;
        } else {
            document = event;
        }

        if (document.languageId === "lean") {
            let file_name = document.fileName;
            let contents = document.getText();
            server.sync(file_name, contents);
        }
    };

    // Send a sync message when the editor changes.
    vscode.workspace.onDidChangeTextDocument(syncLeanFiles);

    // Send a sync message when the editor opens.
    vscode.workspace.onDidOpenTextDocument(syncLeanFiles)

    // Send a sync message when the editor closes.
    vscode.workspace.onDidCloseTextDocument(syncLeanFiles)

    // Send a sync message when the editor saves.
    vscode.workspace.onDidSaveTextDocument(syncLeanFiles);
}