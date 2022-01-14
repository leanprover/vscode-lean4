import { window, Uri, workspace, ExtensionContext } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview';
import { LeanTaskGutter } from './taskgutter'
import { LocalStorageService} from './utils/localStorage'
import { LeanInstaller } from './utils/leanInstaller'
import { LeanpkgService } from './utils/leanpkg';
import { LeanClientProvider } from './utils/clientProvider';
import { addDefaultElanPath } from './config';

function isLean(languageId : string) : boolean {
    return languageId === 'lean' || languageId === 'lean4';
}

function getLeanDocumentUri(){
    let documentUri : Uri = null;
    if (window.activeTextEditor && isLean(window.activeTextEditor.document.languageId))
    {
        documentUri = window.activeTextEditor.document.uri
    }
    else {
        // This happens if vscode starts with a lean file open
        // but the "Getting Started" page is active.
        for (const editor of window.visibleTextEditors) {
            const lang = editor.document.languageId;
            if (isLean(lang)) {
                documentUri = editor.document.uri;
                break;
            }
        }

        if (!documentUri) {
            // this code path should never happen because lean extension is only
            // activated when a lean file is opened, so it should have been in the
            // list of window.visibleTextEditors.  So this is a fallback just in
            // case some weird timing thing happened and file is now closed.
            const workspaceFolders = workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                documentUri = workspaceFolders[0].uri;
            }
        }
    }
    return documentUri;
}

export async function activate(context: ExtensionContext): Promise<any> {

    addDefaultElanPath();

    const defaultToolchain = 'leanprover/lean4:nightly';
    const outputChannel = window.createOutputChannel('Lean: Editor');
    const storageManager = new LocalStorageService(context.workspaceState);
    const pkgService = new LeanpkgService(storageManager, defaultToolchain)
    context.subscriptions.push(pkgService);

    const installer = new LeanInstaller(outputChannel, storageManager, pkgService, defaultToolchain)
    context.subscriptions.push(installer);

    // test lean version in the workspace associated with the active text editor since
    // that editor is probably the one that activated our extension here.
    const uri = getLeanDocumentUri();
    const versionInfo = await installer.testLeanVersion(uri);
    if (versionInfo.version && versionInfo.version !== '4') {
        // ah, then don't activate this extension!
        // this gives us side by side compatibility with the Lean 3 extension.
        return { isLean4Project: false };
    }

    const clientProvider = new LeanClientProvider(storageManager, installer, outputChannel);
    context.subscriptions.push(clientProvider)

    // Register support for unicode input
    // const info = new InfoProvider(client, {language: 'lean4'}, context);
    // context.subscriptions.push(info)

    const abbrev = new AbbreviationFeature();
    context.subscriptions.push(abbrev);

    const docview = new DocViewProvider();
    context.subscriptions.push(docview);

    // pass the abbreviations through to the docview so it can show them on demand.
    docview.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation);

    context.subscriptions.push(new LeanTaskGutter(clientProvider, context))

    pkgService.versionChanged((uri) => installer.handleVersionChanged(uri));

    return  { isLean4Project: true };
}
