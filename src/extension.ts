import semver = require('semver');
import { commands, DocumentFilter, ExtensionContext, languages, workspace, version, extensions } from 'vscode';
import { batchExecuteFile } from './batch';
import { LeanCompletionItemProvider } from './completion';
import { LeanDefinitionProvider } from './definition';
import { LeanDiagnosticsProvider } from './diagnostics';
import { DocViewProvider } from './docview';
import { LeanHoles } from './holes';
import { TacticSuggestions } from './tacticsuggestions';
import { LeanHoverProvider } from './hover';
import { InfoProvider } from './infoview';
import { AbbreviationFeature } from './abbreviation';
import { LeanpkgService } from './leanpkg';
import { RoiManager } from './roi';
import { LeanWorkspaceSymbolProvider } from './search';
import { Server } from './server';
import { LeanStatusBarItem } from './statusbar';
import { LeanSyncService } from './sync';
import { LeanTaskGutter, LeanTaskMessages } from './taskgutter';
import { StaticServer } from './staticserver';
import { LibraryNoteLinkProvider } from './librarynote';

async function checkLean3(): Promise<boolean> {
    const lean4 = extensions.getExtension('leanprover.lean4');
    if (!lean4) {
        return true;
    }
    return !(await lean4.activate()).isLean4Project;
}

// Seeing .olean files in the source tree is annoying, we should
// just globally hide them.
async function configExcludeOLean() {
    const files = workspace.getConfiguration('files');
    const exclude = files.get('exclude');
    exclude['**/*.olean'] = true;
    await files.update('exclude', exclude, true);
}

const LEAN_MODE: DocumentFilter = {
    language: 'lean',
    // The doc view uses the untitled scheme.
    // scheme: 'file',
};

export async function activate(context: ExtensionContext): Promise<void> {
    const isLean3 = await checkLean3();
    if (!isLean3) {
        return;
    }

    void configExcludeOLean();

    const server = new Server();
    context.subscriptions.push(server);

    const roiManager = new RoiManager(server, LEAN_MODE);
    context.subscriptions.push(roiManager);

    // The sync service starts automatically starts
    // the server when it sees a *.lean file.
    context.subscriptions.push(new LeanSyncService(server, LEAN_MODE));

    // Setup the commands.
    context.subscriptions.push(
        commands.registerCommand('lean.restartServer', () => server.restart()),
        commands.registerTextEditorCommand('lean.batchExecute',
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
        languages.registerHoverProvider(LEAN_MODE,
            new LeanHoverProvider(server)));

    // Register support for completion.
    context.subscriptions.push(
        languages.registerCompletionItemProvider(
            LEAN_MODE, new LeanCompletionItemProvider(server), '.'));

    // Register support for unicode input.
    context.subscriptions.push(new AbbreviationFeature());

    // Register support for definition support.
    context.subscriptions.push(
        languages.registerDefinitionProvider(
            LEAN_MODE, new LeanDefinitionProvider(server)));

    // Search
    context.subscriptions.push(
        languages.registerWorkspaceSymbolProvider(
            new LeanWorkspaceSymbolProvider(server)));

    // Holes
    context.subscriptions.push(new LeanHoles(server, LEAN_MODE));


    // Add item to the status bar.
    context.subscriptions.push(new LeanStatusBarItem(server, roiManager));

    let staticServer = null;
    function waitStaticServer() {
        // Add info view: listing either the current goal state or a list of all error messages
        const infoView = new InfoProvider(server, LEAN_MODE, context, staticServer);
        context.subscriptions.push(infoView);
        context.subscriptions.push(new DocViewProvider(staticServer));
        // Tactic suggestions
        context.subscriptions.push(new TacticSuggestions(server, infoView, LEAN_MODE));
    }
    // https://github.com/microsoft/vscode/issues/89038 fixed in 1.47
    if (semver.gte(version, '1.47.0')) {
        waitStaticServer();
    } else {
        staticServer = new StaticServer(context);
        context.subscriptions.push(staticServer);
        staticServer.server.on('listening', waitStaticServer);
    }

    context.subscriptions.push(new LeanpkgService(server));

    context.subscriptions.push(languages.registerDocumentLinkProvider(LEAN_MODE,
        new LibraryNoteLinkProvider()));
}
