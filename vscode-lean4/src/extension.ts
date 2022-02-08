import { window, Uri, workspace, ExtensionContext, TextDocument } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview';
import { LeanTaskGutter } from './taskgutter'
import { LocalStorageService} from './utils/localStorage'
import { LeanInstaller } from './utils/leanInstaller'
import { LeanpkgService } from './utils/leanpkg';
import { LeanClientProvider } from './utils/clientProvider';
import { addDefaultElanPath } from './config';
import { dirname, basename } from 'path';

function isLean(languageId : string) : boolean {
    return languageId === 'lean' || languageId === 'lean4';
}


function getLeanDocument() : TextDocument | null {
    let document : TextDocument = null;
    if (window.activeTextEditor && isLean(window.activeTextEditor.document.languageId))
    {
        document = window.activeTextEditor.document
    }
    else {
        // This happens if vscode starts with a lean file open
        // but the "Getting Started" page is active.
        for (const editor of window.visibleTextEditors) {
            const lang = editor.document.languageId;
            if (isLean(lang)) {
                document = editor.document;
                break;
            }
        }
    }
    return document;
}


function getLeanDocumentUri(doc: TextDocument) : Uri | null {
    if (doc) {
        return doc.uri;
    }
    else {
        // this code path should never happen because lean extension is only
        // activated when a lean file is opened, so it should have been in the
        // list of window.visibleTextEditors.  So this is a fallback just in
        // case some weird timing thing happened and file is now closed.
        const workspaceFolders = workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri;
        }
    }
    return null;
}

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
            const newPath = dirname(dirname(path)); // above the 'bin' folder.
            storageManager.setLeanPath(newPath === '.' ? '' : newPath);
        }
    }

    const pkgService = new LeanpkgService(storageManager, defaultToolchain)
    context.subscriptions.push(pkgService);

    const installer = new LeanInstaller(outputChannel, storageManager, pkgService, defaultToolchain)
    context.subscriptions.push(installer);

    // test lean version in the workspace associated with the active text editor since
    // that editor is probably the one that activated our extension here.
    const doc = getLeanDocument();
    const uri = getLeanDocumentUri(doc);
    const versionInfo = await installer.testLeanVersion(uri);
    if (versionInfo.version && versionInfo.version !== '4') {
        // ah, then don't activate this extension!
        // this gives us side by side compatibility with the Lean 3 extension.
        return { isLean4Project: false };
    }

    const clientProvider = new LeanClientProvider(storageManager, installer, outputChannel);
    context.subscriptions.push(clientProvider)

    const info = new InfoProvider(clientProvider, {language: 'lean4'}, context);
    context.subscriptions.push(info)

    const abbrev = new AbbreviationFeature();
    context.subscriptions.push(abbrev);

    const docview = new DocViewProvider();
    context.subscriptions.push(docview);

    // pass the abbreviations through to the docview so it can show them on demand.
    docview.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation);

    context.subscriptions.push(new LeanTaskGutter(clientProvider, context))

    pkgService.versionChanged((uri) => installer.handleVersionChanged(uri));
    pkgService.lakeFileChanged((uri) => installer.handleLakeFileChanged(uri));

    return  { isLean4Project: true };
}
