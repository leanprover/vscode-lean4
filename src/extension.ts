import loadJsonFile = require('load-json-file');
import { commands, DocumentFilter, ExtensionContext, languages, Uri, workspace } from 'vscode';
import { batchExecuteFile } from './batch';
import { LeanCompletionItemProvider } from './completion';
import { LeanDefinitionProvider } from './definition';
import { LeanDiagnosticsProvider } from './diagnostics';
import { DocViewProvider } from './docview';
import { LeanHoles } from './holes';
import { LeanHoverProvider } from './hover';
import { InfoProvider } from './infoview';
import { inputModeLanguages, LeanInputAbbreviator, LeanInputExplanationHover } from './input';
import { LeanpkgService } from './leanpkg';
import { RoiManager } from './roi';
import { LeanWorkspaceSymbolProvider } from './search';
import { Server } from './server';
import { LeanStatusBarItem } from './statusbar';
import { LeanSyncService } from './sync';
import { LeanTaskGutter, LeanTaskMessages } from './taskgutter';

// Seeing .olean files in the source tree is annoying, we should
// just globally hide them.
function configExcludeOLean() {
    const files = workspace.getConfiguration('files');
    const exclude = files.get('exclude');
    exclude['**/*.olean'] = true;
    files.update('exclude', exclude, true);
}

const LEAN_MODE: DocumentFilter = {
    language: 'lean',
    // The doc view uses the untitled scheme.
    // scheme: 'file',
};

export function activate(context: ExtensionContext) {
    configExcludeOLean();

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
    (async () => {
        const translations: any = await loadJsonFile(context.asAbsolutePath('translations.json'));
        const inputLanguages: string[] = inputModeLanguages();
        const hoverProvider =
            languages.registerHoverProvider(inputLanguages, new LeanInputExplanationHover(translations));
        context.subscriptions.push(
            hoverProvider,
            new LeanInputAbbreviator(translations));
    })();

    // Load the language-configuration manually, so that we can set the wordPattern.
    let langConf = Uri.file(context.asAbsolutePath('language-configuration.json')).toJSON();
    langConf = { comments: langConf.comments, brackets: langConf.brackets,
        autoClosingPairs: langConf.autoClosingPairs, surroundingPairs: langConf.surroundingPairs,
        wordPattern: /(-?\d*\.\d\w*)|([^`~!@$%^&*()-=+\[{\]}⟨⟩\\|;:",./?\s]+)/ };
    context.subscriptions.push(
        languages.setLanguageConfiguration('lean', langConf),
    );

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

    // Add info view: listing either the current goal state or a list of all error messages
    context.subscriptions.push(new InfoProvider(server, LEAN_MODE, context));

    context.subscriptions.push(new LeanpkgService(server));

    context.subscriptions.push(new DocViewProvider());
}
