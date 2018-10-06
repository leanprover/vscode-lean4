import * as loadJsonFile from 'load-json-file';
import { commands, ExtensionContext, languages, Uri, workspace } from 'vscode';
import { batchExecuteFile } from './batch';
import { LeanCompletionItemProvider } from './completion';
import { LEAN_MODE } from './constants';
import { LeanDefinitionProvider } from './definition';
import { LeanDiagnosticsProvider } from './diagnostics';
import { LeanHoles } from './holes';
import { LeanHoverProvider } from './hover';
import { InfoProvider } from './infoview';
import { LeanInputAbbreviator, LeanInputExplanationHover } from './input';
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

let server: Server;

export function activate(context: ExtensionContext) {
    configExcludeOLean();

    server = new Server();
    context.subscriptions.push(server);
    server.connect();

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
        const translations: any = await loadJsonFile.default(context.asAbsolutePath('translations.json'));
        context.subscriptions.push(
            languages.registerHoverProvider(LEAN_MODE, new LeanInputExplanationHover(translations)),
            new LeanInputAbbreviator(translations, LEAN_MODE));
    })();

    // Load the language-configuration manually, so that we can set the wordPattern.
    let langConf = Uri.file(context.asAbsolutePath('language-configuration.json')).toJSON();
    langConf = { comments: langConf.comments, brackets: langConf.brackets,
        autoClosingPairs: langConf.autoClosingPairs, surroundingPairs: langConf.surroundingPairs,
        wordPattern: /(-?\d*\.\d\w*)|([^`~!@$%^&*()-=+\[{\]}\\|;:",./?\s]+)/ };
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
    if (server.atLeastLeanVersion('3.1.1')) {
        context.subscriptions.push(new LeanHoles(server, LEAN_MODE));
    }

    if (server.supportsROI) {
        server.roi('nothing', []);
    } // activate ROI support

    context.subscriptions.push(new LeanSyncService(server, LEAN_MODE));

    let roiManager: RoiManager | undefined = null;
    if (server.supportsROI) {
        roiManager = new RoiManager(server, LEAN_MODE);
        context.subscriptions.push(roiManager);
    }

    // Add item to the status bar.
    context.subscriptions.push(new LeanStatusBarItem(server, roiManager));

    // Add info view: listing either the current goal state or a list of all error messages
    context.subscriptions.push(new InfoProvider(server, LEAN_MODE, context));

    context.subscriptions.push(new LeanpkgService(server));
}
