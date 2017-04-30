import * as vscode from 'vscode';
import * as loadJsonFile from 'load-json-file';
import { Server, ServerStatus } from './server';
import { LeanHoverProvider } from './hover';
import { LeanCompletionItemProvider } from './completion';
import { LeanInputCompletionProvider, LeanInputAbbreviator } from './input';
import { LeanDefinitionProvider } from './definition'
import { displayGoalAtPosition } from './goal';
import { batchExecuteFile } from './batch';
import { createLeanStatusBarItem } from './status';
import { RoiManager } from './roi';
import { getExecutablePath, getRoiModeDefault, getMemoryLimit, getTimeLimit } from './util';
import {Message} from 'lean-client-js-node';

const LEAN_MODE : vscode.DocumentFilter = {
    language: "lean",
    scheme: 'file'
}

let diagnosticCollection: vscode.DiagnosticCollection;
let taskMessages: vscode.DiagnosticCollection;

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

function updateDiagnostics(collection : vscode.DiagnosticCollection, messages: Message[]) {
    let diagnosticMap : Map<string, vscode.Diagnostic[]> = new Map();
    for (const message of messages) {
        let file = vscode.Uri.file(message.file_name);
        let line = Math.max(message.pos_line - 1, 0);
        let range = new vscode.Range(line, message.pos_col, line, message.pos_col);
        let diagnostics = diagnosticMap.get(file.toString());
        if (!diagnostics) { diagnostics = []; }
        diagnostics.push(new vscode.Diagnostic(range, message.text, toSeverity(message.severity)));
        diagnosticMap.set(file.toString(), diagnostics);
    }

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

        server = new Server(executablePath, working_directory, getMemoryLimit(), getTimeLimit());
    } catch (e) {
        vscode.window.showErrorMessage(
            `Unable to start the Lean server process: ${e}`);
        vscode.window.showWarningMessage(
            "The lean.executablePath may be incorrect, ensure the variable is a valid Lean executable");
        return;
    }

    // Ensure that the server is disposed of.
    context.subscriptions.push(server);

    // Setup the commands.
    let restartDisposable = vscode.commands.registerCommand('lean.restartServer', () => {
        server.restart();
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
    server.allMessages.on((messages) => {
        diagnosticCollection.clear();
        updateDiagnostics(diagnosticCollection, messages.msgs);
    });

    // Register the support for diagnostics.
    diagnosticCollection = vscode.languages.createDiagnosticCollection('lean');
    context.subscriptions.push(diagnosticCollection);

    // We need to ensure to reset anything stateful right here otherwise we will
    // have ghost diagnostics
    server.restarted.on(() => diagnosticCollection.clear());

    // Task messages.
    taskMessages = vscode.languages.createDiagnosticCollection('lean-tasks');
    context.subscriptions.push(taskMessages);
    context.subscriptions.push(server.statusChanged.on((status) => {
        const diagsPerFile = new Map<string, vscode.Diagnostic[]>();

        if (vscode.workspace.getConfiguration('lean').get('progressMessages')) {
            for (const task of status.tasks) {
                let diags = diagsPerFile.get(task.file_name);
                if (!diags) diagsPerFile.set(task.file_name, diags = []);
                diags.push(new vscode.Diagnostic(
                    new vscode.Range(task.pos_line - 1, task.pos_col, task.end_pos_line - 1, task.end_pos_col),
                    task.desc, vscode.DiagnosticSeverity.Information,
                ));
            }
        }

        taskMessages.clear();
        diagsPerFile.forEach((diags, file) => taskMessages.set(vscode.Uri.file(file), diags));
    }));

    // Register the support for hovering.
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(LEAN_MODE,
            new LeanHoverProvider(server)));

    // Register support for completion.
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            LEAN_MODE, new LeanCompletionItemProvider(server), '.'));

    // Register support for unicode input.
    loadJsonFile(context.asAbsolutePath("translations.json")).then(json => {
        if (vscode.workspace.getConfiguration('lean').get('newInput')) {
            context.subscriptions.push(new LeanInputAbbreviator(json, LEAN_MODE));
        } else {
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider(
                    LEAN_MODE, new LeanInputCompletionProvider(json), '\\'));
        }
    });

    // Load the language-configuration manually, so that we can set the wordPattern.
    let json = vscode.Uri.file(context.asAbsolutePath("language-configuration.json")).toJSON();
    json = { "comments": json.comments, "brackets": json.brackets,
        "autoClosingPairs": json.autoClosingPairs, "surroundingPairs": json.surroundingPairs,
        "wordPattern": /(-?\d*\.\d\w*)|([^`~!@$%^&*()-=+\[{\]}\\|;:",./?\s]+)/ };
    context.subscriptions.push(
        vscode.languages.setLanguageConfiguration("lean", json)
    );

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

    if (server.supportsROI)
        server.roi("nothing", []); // activate ROI support

    // Send a sync message on editor changes.
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(syncLeanFile));
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(syncLeanFile));
    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(syncLeanFile));
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(syncLeanFile));

    // Sync files that are already open.
    vscode.workspace.textDocuments.forEach(syncLeanFile);

    // Add item to the status bar.
    let statusBar = createLeanStatusBarItem();
    context.subscriptions.push(statusBar);

    if (server.supportsROI) {
        let roiManager = new RoiManager(server);
        context.subscriptions.push(roiManager);
        roiManager.statusBarItem.show();

        let handler = (event) => roiManager.send();
        context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(handler));
        context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(handler));
        // context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(handler));
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(handler));
        context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(handler));
        context.subscriptions.push(server.restarted.on(handler));

        context.subscriptions.push(vscode.commands.registerTextEditorCommand(
            "lean.roiMode.nothing",
            (editor, edit, args) => roiManager.checkNothing()
        ));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand(
            "lean.roiMode.visibleFiles",
            (editor, edit, args) => roiManager.checkVisibleFiles()
        ));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand(
            "lean.roiMode.openFiles",
            (editor, edit, args) => roiManager.checkOpenFiles()
        ));
        context.subscriptions.push(vscode.commands.registerTextEditorCommand(
            "lean.roiMode.projectFiles",
            (editor, edit, args) => roiManager.checkProjectFiles()
        ));

        // Read the default mode for starting the ROI manager.
        let roiDefault = getRoiModeDefault();

        switch (roiDefault) {
            case "nothing":
                roiManager.checkNothing();
                break;
            case "visible":
                roiManager.checkVisibleFiles();
                break;
            case "open":
                roiManager.checkOpenFiles();
                break;
            case "project":
                roiManager.checkProjectFiles();
                break;
            default:
                // do nothing, should probably set up the error reporting to be global, and log an error here.
        }
    }

    server.restarted.on(() => vscode.workspace.textDocuments.forEach(syncLeanFile));

    let taskDecoration = vscode.window.createTextEditorDecorationType({
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        overviewRulerColor: 'rgba(255, 165, 0, 0.5)',
        dark: {
            gutterIconPath: context.asAbsolutePath('images/progress-dark.svg'),
        },
        light: {
            gutterIconPath: context.asAbsolutePath('images/progress-light.svg'),
        },
        gutterIconSize: 'contain',
    });

    server.statusChanged.on((serverStatus) => {
        // Update the status bar when the server changes state.
        if (serverStatus.isRunning) {
            statusBar.text = "Lean: $(sync) " + `${serverStatus.numberOfTasks}`;
        } else if (serverStatus.stopped) {
            statusBar.text = "Lean: $(x)";
        } else {
            statusBar.text = "Lean: $(check) ";
        }
        // Not sure if we need to reshow the the status bar here
        statusBar.show();

        for (let editor of vscode.window.visibleTextEditors) {
            let ranges: vscode.DecorationOptions[] = [];
            for (let task of serverStatus.tasks) {
                if (task.file_name == editor.document.fileName) {
                    const range = new vscode.Range(
                        task.pos_line - 1, task.pos_col,
                        task.end_pos_line - 1, task.end_pos_col,
                    );
                    ranges.push({
                        range,
                        hoverMessage: task.desc,
                    });
                }
            }
            editor.setDecorations(taskDecoration, ranges);
        }
    });
}
