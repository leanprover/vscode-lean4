import * as vscode from 'vscode';
import * as loadJsonFile from 'load-json-file';
import {Message} from 'lean-client-js-node';
import { Server, ServerStatus } from './server';
import { LeanHoverProvider } from './hover';
import { LeanCompletionItemProvider } from './completion';
import { LeanInputCompletionProvider, LeanInputExplanationHover, LeanInputAbbreviator } from './input';
import { LeanDefinitionProvider } from './definition'
import { batchExecuteFile } from './batch';
import { LeanStatusBarItem } from './statusbar';
import { RoiManager, RoiMode } from './roi';
import {InfoProvider} from './infoview';
import {LeanDiagnosticsProvider} from './diagnostics';
import {LeanSyncService} from './sync';
import { LeanTaskGutter, LeanTaskMessages } from "./taskgutter";
import {LEAN_MODE} from './constants';
import { LeanWorkspaceSymbolProvider } from "./search";
import { LeanHoles } from "./holes";
import {LeanpkgService} from './leanpkg';

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

    server = new Server();
    context.subscriptions.push(server);
    server.connect();

    // Setup the commands.
    context.subscriptions.push(
        vscode.commands.registerCommand('lean.restartServer', () => server.restart()),
        vscode.commands.registerTextEditorCommand('lean.batchExecute',
            (editor, edit, args) => { batchExecuteFile(server, editor, edit, args); }),
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

    // Holes
    if (server.atLeastLeanVersion('3.1.1')) {
        context.subscriptions.push(new LeanHoles(server, LEAN_MODE));
    }

    if (server.supportsROI)
        server.roi("nothing", []); // activate ROI support

    context.subscriptions.push(new LeanSyncService(server, LEAN_MODE));

    let roiManager: RoiManager | undefined = null;
    if (server.supportsROI) {
        roiManager = new RoiManager(server, LEAN_MODE);
        context.subscriptions.push(roiManager)
    }

    // Add item to the status bar.
    context.subscriptions.push(new LeanStatusBarItem(server, roiManager));

    // Add info view: listing either the current goal state or a list of all error messages
    context.subscriptions.push(new InfoProvider(server, LEAN_MODE, context));

    context.subscriptions.push(new LeanpkgService(server));
}
