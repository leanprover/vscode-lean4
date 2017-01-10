import * as vscode from 'vscode';
import * as loadJsonFile from 'load-json-file';
import { Server, ServerStatus } from './server';
import { LeanHoverProvider } from './hover';
import { LeanCompletionItemProvider } from './completion';
import { LeanInputCompletionProvider } from './input';
import { LeanDefinitionProvider } from './definition'
import { displayGoalAtPosition } from './goal';
import { batchExecuteFile } from './batch';
import { createLeanStatusBarItem } from './status';
import { getExecutablePath } from './util';

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

// Seeing .olean files in the source tree is annoying, we should
// just globally hide them.
function configExcludeOLean() {
    let files = vscode.workspace.getConfiguration('files');
    let exclude = files.get('exclude');
    exclude["**/*.olean"] = true;
    files.update('exclude', exclude, true);
}

let server : Server;

export function activate(context: vscode.ExtensionContext) {
    configExcludeOLean();

    try {
        let working_directory = vscode.workspace.rootPath;
        let executablePath = getExecutablePath();

        console.log("Starting server: " + executablePath + "; in directory: " + working_directory)

        server = new Server(executablePath, working_directory);
    } catch (e) {
        vscode.window.showErrorMessage(
            "Unable to start the Lean server process: " + e);
        vscode.window.showWarningMessage(
            "The lean.executablePath may be incorrect, make sure it is a valid Lean executable");
        return;
    }

    // Ensure that the server is disposed of.
    context.subscriptions.push(server);

    // Setup the commands.
    let restartDisposable = vscode.commands.registerCommand('lean.restartServer', () => {
        server.restart(vscode.workspace.rootPath);
    });

    let goalDisposable = vscode.commands.registerTextEditorCommand(
        'lean.displayGoal',
        (editor, edit, args) => { displayGoalAtPosition(server, editor, edit, args) });

    let batchDisposable = vscode.commands.registerTextEditorCommand(
        'lean.batchExecute',
        (editor, edit, args) => { batchExecuteFile(editor, edit, args); });

    // Register their disposables as well.
    context.subscriptions.push(restartDisposable);
    context.subscriptions.push(goalDisposable);
    context.subscriptions.push(batchDisposable);

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

    // Register support for unicode input.
    loadJsonFile(context.asAbsolutePath("translations.json")).then(json => {
        context.subscriptions.push(
            vscode.languages.registerCompletionItemProvider(
                LEAN_MODE, new LeanInputCompletionProvider(json), '\\'));
    });

    // Register support for definition support.
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            LEAN_MODE, new LeanDefinitionProvider(server)));

    let syncLeanFile = (event : SyncEvent) => {
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
    vscode.workspace.onDidChangeTextDocument(syncLeanFile);

    // Send a sync message when the editor opens.
    vscode.workspace.onDidOpenTextDocument(syncLeanFile);

    // Send a sync message when the editor closes.
    vscode.workspace.onDidCloseTextDocument(syncLeanFile);

    // Send a sync message when the editor saves.
    vscode.workspace.onDidSaveTextDocument(syncLeanFile);

    // Sync files that are already open.
    vscode.workspace.textDocuments.forEach(syncLeanFile);

    // Add item to the status bar.
    let statusBar = createLeanStatusBarItem();

    // Remember to dispose of the status bar.
    context.subscriptions.push(statusBar);

    // Update the status bar when the server changes state.
    server.onStatusChange((serverStatus : ServerStatus) => {
        if (serverStatus.isRunning) {
            statusBar.text = "Lean: $(sync) " + `${serverStatus.numberOfTasks}`;
        } else if (serverStatus.stopped) {
            statusBar.text = "Lean: $(x)";
        } else {
            statusBar.text = "Lean: $(check) ";
        }

        // Not sure if we need to reshow the the status bar here
        statusBar.show();
    });
}
