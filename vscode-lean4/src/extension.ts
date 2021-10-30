import { workspace, commands, window, languages, ExtensionContext, TextEditor, Range } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { LeanClient } from './leanclient'
import { InfoProvider } from './infoview'
import { LeanTaskGutter } from './taskgutter'
import { LocalStorageService} from './utils/localStorage'
import { LeanInstaller } from './utils/leanInstaller'
import { LeanpkgService } from './utils/leanpkg';
import { addDefaultElanPath } from './config';
import { AbbreviationProvider } from './abbreviation/AbbreviationProvider'

export async function activate(context: ExtensionContext): Promise<any> {

    addDefaultElanPath();

    const outputChannel = window.createOutputChannel('Lean: Editor');
    const storageManager = new LocalStorageService(context.workspaceState);
    const pkgService = new LeanpkgService(storageManager)
    context.subscriptions.push(pkgService);
    const leanVersion = await pkgService.findLeanPkgVersionInfo();

    const installer = new LeanInstaller(outputChannel, storageManager)
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

    async function checkHelp(editor : TextEditor) : Promise<void> {
        const sel = editor.selection;
        if (sel.end.character >= 4){
            const range = new Range(sel.end.translate(0, - 4), sel.end);
            const abbreviation = editor.document.getText(range);
            if (abbreviation === 'help') {
                // remove the help text.
                const v = await editor.edit((builder) => {
                    builder.replace( range, '');
                });

                // display the HTML table definition of all abbreviations.
                const list = abbrev.abbreviations.getAbbreviationNames();
                let help = "<div className='mv2'><table><tr><th>Abbreviation</th><th>Unicode Symbol</th></tr>"
                for (const name of list) {
                    const u = abbrev.abbreviations.getSymbolForAbbreviation(name);
                    if (u.indexOf('CURSOR') < 0) {
                        help += `<tr><td>${name}</td><td>${u}</td></tr>`;
                    }
                }
                help += '</table></div>';
                info.displayHtml(help);
            }
        }
    }

    abbrev.abbreviations.abbreviationCompleted((v) => checkHelp(v));

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
