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
import {InfoProvider} from './infoview';
import {LeanDiagnosticsProvider} from './diagnostics';
import {LeanSyncService} from './sync';
import {Message} from 'lean-client-js-node';
import { LeanTaskGutter, LeanTaskMessages } from "./taskgutter";
import {LEAN_MODE} from './constants';
import { LeanWorkspaceSymbolProvider } from "./search";

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
    context.subscriptions.push(
        new LeanTaskGutter(server, context),
        new LeanTaskMessages(server),
    );

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

    // Search
    context.subscriptions.push(
        vscode.languages.registerWorkspaceSymbolProvider(
            new LeanWorkspaceSymbolProvider(server)));

    if (server.supportsROI)
        server.roi("nothing", []); // activate ROI support

    context.subscriptions.push(new LeanSyncService(server, LEAN_MODE));

    let roiManager: RoiManager | undefined = null;
    if (server.supportsROI) {
        roiManager = new RoiManager(server, LEAN_MODE);
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

    const infoProvider = new InfoProvider(server, LEAN_MODE);
    context.subscriptions.push(
        infoProvider,
        vscode.workspace.registerTextDocumentContentProvider(
            infoProvider.scheme, infoProvider),
        vscode.commands.registerTextEditorCommand('lean.infoView', (editor) => {
            vscode.workspace.openTextDocument(infoProvider.leanInfoUrl)
                .then(doc => vscode.window.showTextDocument(
                    doc, editor.viewColumn + 1));
        }),
    );
}
