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

    const defaultToolchain = 'leanprover/lean4:nightly';
    const outputChannel = window.createOutputChannel('Lean: Editor');
    const storageManager = new LocalStorageService(context.workspaceState);
    // migrate to new setting where it is now a directory location, not the
    // actual full file name of the lean program.
    const path = storageManager.getLeanPath();
    if (path) {
        const filename = basename(path);
        if (filename === 'lean' || filename === 'lean.exe') {
            const newPath = dirname(path);
            storageManager.setLeanPath(newPath === '.' ? '' : newPath);
        }
    }

    const pkgService = new LeanpkgService(storageManager, defaultToolchain)
    context.subscriptions.push(pkgService);

    const installer = new LeanInstaller(outputChannel, storageManager, pkgService, defaultToolchain)
    context.subscriptions.push(installer);

    const versionInfo = await installer.testLeanVersion();
    if (versionInfo.version && versionInfo.version !== '4') {
        // ah, then don't activate this extension!
        // this gives us side by side compatibility with the Lean 3 extension.
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

    let busy = false
    installer.installChanged(async () => {
        // This code is here to handle the case where elan just got installed and now
        // we can restart the LeanClient to get things up and running.
        // Note: just the fact that the console.log commands are here makes this work.
        // Remove them and mysteriously sometimes the client.restart() doesn't happen or doesn't work.
        if (busy) {
            console.log("Guarding against multiple installChanged calls");
            return;
        }
        busy = true; // avoid re-entrancy since testLeanVersion can take a while.
        try {
            // have to check again here in case elan install had --default-toolchain none.
            const version = await installer.testLeanVersion();
            if (version.version === '4') {
                console.log("Auto restarting Lean");
                void client.restart()
            } else {
                console.log("Lean version not ok: " + version.error);
            }
        } catch (e) {
            console.log("Exception checking lean version: " + e);
        }
        busy = false;
    });

    pkgService.versionChanged((v) => installer.handleVersionChanged(v));
    pkgService.lakeFileChanged(() => installer.handleLakeFileChanged());
    client.serverFailed((err) => window.showErrorMessage(err));

    if (versionInfo.version === '4' && !versionInfo.error) {
        void client.start();
    }
    return  { isLean4Project: true };
}
