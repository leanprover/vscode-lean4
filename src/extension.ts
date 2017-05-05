import * as vscode from 'vscode';
import * as loadJsonFile from 'load-json-file';
import { Server, ServerStatus } from './server';
import { LeanHoverProvider } from './hover';
import { LeanCompletionItemProvider } from './completion';
import { LeanInputCompletionProvider, LeanInputExplanationHover, LeanInputAbbreviator } from './input';
import { LeanDefinitionProvider } from './definition'
import { displayGoalAtPosition } from './goal';
import { batchExecuteFile } from './batch';
import { LeanStatusBarItem } from './statusbar';
import { RoiManager, RoiMode } from './roi';
import { getExecutablePath, getMemoryLimit, getTimeLimit } from './util';
import {ErrorViewProvider} from './errorview';
import {LeanDiagnosticsProvider} from './diagnostics';
import {LeanSyncService} from './sync';
import {Message} from 'lean-client-js-node';

const LEAN_MODE : vscode.DocumentFilter = {
    language: "lean",
    scheme: 'file'
}

let taskMessages: vscode.DiagnosticCollection;

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
    context.subscriptions.push(
        vscode.commands.registerCommand('lean.restartServer', () => server.restart()),
        vscode.commands.registerTextEditorCommand('lean.displayGoal',
            (editor, edit, args) => { displayGoalAtPosition(server, editor, edit, args) }),
        vscode.commands.registerTextEditorCommand('lean.batchExecute',
            (editor, edit, args) => { batchExecuteFile(editor, edit, args); }),
    );

    context.subscriptions.push(new LeanDiagnosticsProvider(server));

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
        context.subscriptions.push(vscode.languages.registerHoverProvider(LEAN_MODE,
            new LeanInputExplanationHover(json)));
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

    if (server.supportsROI)
        server.roi("nothing", []); // activate ROI support

    context.subscriptions.push(new LeanSyncService(server, LEAN_MODE));

    let roiManager: RoiManager | undefined = null;
    if (server.supportsROI) {
        roiManager = new RoiManager(server);
        context.subscriptions.push(roiManager)
        context.subscriptions.push(vscode.commands.registerCommand("lean.roiMode.nothing",
            () => roiManager.check(RoiMode.Nothing)));
        context.subscriptions.push(vscode.commands.registerCommand("lean.roiMode.visibleFiles",
            () => roiManager.check(RoiMode.VisibleFiles)));
        context.subscriptions.push(vscode.commands.registerCommand("lean.roiMode.openFiles",
            () => roiManager.check(RoiMode.OpenFiles)));
        context.subscriptions.push(vscode.commands.registerCommand("lean.roiMode.projectFiles",
            () => roiManager.check(RoiMode.ProjectFiles)));
    }

    // Add item to the status bar.
    context.subscriptions.push(new LeanStatusBarItem(server, roiManager));

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

    const errorViewProvider = new ErrorViewProvider(server);
    context.subscriptions.push(
        errorViewProvider,
        vscode.workspace.registerTextDocumentContentProvider(
            errorViewProvider.scheme, errorViewProvider),
        vscode.commands.registerTextEditorCommand('lean.errorView', (editor) => {
            const errorsUri = errorViewProvider.encodeUri(editor.document.uri.fsPath);
            vscode.workspace.openTextDocument(errorsUri)
                .then(doc => vscode.window.showTextDocument(
                    doc, editor.viewColumn + 1));
        }),
    );
}
