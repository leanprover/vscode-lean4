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

export async function activate(context: ExtensionContext): Promise<any> {

    addDefaultElanPath();

    const defaultToolchain = 'leanprover/lean4:nightly';
    const outputChannel = window.createOutputChannel('Lean: Editor');
    const storageManager = new LocalStorageService(context.workspaceState);
    const pkgService = new LeanpkgService(storageManager, defaultToolchain)
    context.subscriptions.push(pkgService);
    let leanVersion = await pkgService.findLeanPkgVersionInfo();

    const installer = new LeanInstaller(outputChannel, storageManager, pkgService, defaultToolchain)
    context.subscriptions.push(installer);
    if (!leanVersion) {
        leanVersion = storageManager.getLeanVersion();
    }

    if (!leanVersion){
        const hasElan = await installer.hasElan();
        if (!hasElan) {
            // Ah, then we need to install elan and since we have no leanVersion
            // we might as well install the default toolchain as well.
            void installer.showInstallOptions(defaultToolchain);
        } else {
            const defaultVersion = await installer.getDefaultToolchain();
            if (!defaultVersion) {
                void installer.showToolchainOptions();
            } else {
                leanVersion = defaultVersion;
            }
        }
    }
    else {
        const result = await installer.testLeanVersion(leanVersion);
        if (result !== '4') {
            // ah, then don't activate this extension!
            return { isLean4Project: false };
        }
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
    client.serverFailed((err) => window.showErrorMessage(err));

    if (leanVersion) {
        void client.start();
    }
    return  { isLean4Project: true };
}
