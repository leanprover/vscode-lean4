import { workspace, commands, window, languages, ExtensionContext, TextEditor, Range } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { LeanClient } from './leanclient'
import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview';
import { LeanTaskGutter } from './taskgutter'
import { LocalStorageService} from './utils/localStorage'
import { LeanInstaller } from './utils/leanInstaller'
import { LeanpkgService } from './utils/leanpkg';
import { addDefaultElanPath } from './config';
import { dirname, basename } from 'path';

export async function activate(context: ExtensionContext): Promise<any> {

    addDefaultElanPath();

    const outputChannel = window.createOutputChannel('Lean: Editor');
    const storageManager = new LocalStorageService(context.workspaceState);
    // migrate to new setting where it is now a directory location, not the
    // actual full file name of the lean program.
    const path = storageManager.getLeanPath();
    if (path) {
        const filename = basename(path);
        if (filename === 'lean' || filename === 'lean.exe') {
            const newPath = dirname(path);
            storageManager.setLeanPath(newPath == '.' ? '' : newPath);
        }
    }

    const pkgService = new LeanpkgService(storageManager)
    context.subscriptions.push(pkgService);
    const leanVersion = await pkgService.findLeanPkgVersionInfo();

    const installer = new LeanInstaller(outputChannel, storageManager, pkgService)
    context.subscriptions.push(installer);

    const result = await installer.testLeanVersion(leanVersion);
    if (result !== '4') {
        // ah, then don't activate this extension!
        return { isLean4Project: false };
    }

    await Promise.all(workspace.textDocuments.map(async (doc) =>
        doc.languageId === 'lean' && languages.setTextDocumentLanguage(doc, 'lean4')))

    const client: LeanClient = new LeanClient(storageManager, outputChannel)
    context.subscriptions.push(client)

    // Register support for unicode input
    const info = new InfoProvider(client, {language: 'lean4'}, context);
    context.subscriptions.push(info)

    const abbrev = new AbbreviationFeature();
    context.subscriptions.push(abbrev);

    const docview = new DocViewProvider();
    context.subscriptions.push(docview);

    // pass the abbreviations through to the docview so it can show them on demand.
    docview.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation);

    context.subscriptions.push(new LeanTaskGutter(client, context))

    context.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
        if (!window.activeTextEditor) { return }
        client.refreshFileDependencies(window.activeTextEditor)
    }))
    context.subscriptions.push(commands.registerCommand('lean4.restartServer', () => client.restart()));

    installer.installChanged(async (v) => {
        // have to check again here in case elan install had --default-toolchain none.
        await installer.testLeanVersion(leanVersion);
        void client.restart()
    });
    pkgService.versionChanged((v) => installer.handleVersionChanged(v));
    client.serverFailed((err) => installer.showInstallOptions());

    void client.start()
    return  { isLean4Project: true };
}
