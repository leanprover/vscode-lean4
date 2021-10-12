import { workspace, commands, window, languages, ExtensionContext } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { LeanClient } from './leanclient'
import { InfoProvider } from './infoview'
import { LeanTaskGutter } from './taskgutter'
import { LocalStorageService} from './utils/localStorage'
import { LeanInstaller } from './utils/leanInstaller'
import { executablePath } from './config'
import { LeanpkgService } from './utils/leanpkg';

export async function activate(context: ExtensionContext): Promise<any> {

    const storageManager = new LocalStorageService(context.workspaceState);
    const pkgService = new LeanpkgService()
    context.subscriptions.push(pkgService);
    const leanVersion = await pkgService.findLeanPkgVersionInfo();

    const outputChannel = window.createOutputChannel('Lean: Editor');
    const installer = new LeanInstaller(outputChannel, leanVersion)
    let executable = storageManager.getLeanPath();
    if (!executable) executable = executablePath();
    const result = await installer.checkLeanVersion(executable)
    let lean4Installed = true;
    if (result.error) {
        // then no lean version was found and we'll proceed with the
        // idea that the LeanClient will present a UI for installing
        // Lean 4 to bootstrap this project.
        lean4Installed = false;
    }
    else if (result.version !== '4')
    {
        // ah, then don't activate this extension!
        return { isLean4Project: false };
    }

    await Promise.all(workspace.textDocuments.map(async (doc) =>
        doc.languageId === 'lean' && languages.setTextDocumentLanguage(doc, 'lean4')))

    const client: LeanClient = new LeanClient(installer, storageManager, outputChannel)
    context.subscriptions.push(client)

    // Register support for unicode input
    context.subscriptions.push(new AbbreviationFeature())

    context.subscriptions.push(new InfoProvider(client, {language: 'lean4'}, context))

    context.subscriptions.push(new LeanTaskGutter(client, context))

    context.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
        if (!window.activeTextEditor) { return }
        client.refreshFileDependencies(window.activeTextEditor)
    }))
    context.subscriptions.push(commands.registerCommand('lean4.restartServer', () => client.restart()));

    context.subscriptions.push(commands.registerCommand('lean4.selectInterpreter', () => client.selectInterpreter()));

    pkgService.versionChanged((v) => client.handleVersionChanged(v));

    void client.start()
    return  { isLean4Project: true };
}
