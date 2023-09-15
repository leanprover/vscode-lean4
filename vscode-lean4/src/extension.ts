import { window, ExtensionContext, TextDocument, tasks } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview';
import { LeanTaskGutter } from './taskgutter'
import { LeanInstaller } from './utils/leanInstaller'
import { LeanpkgService } from './utils/leanpkg';
import { LeanClientProvider } from './utils/clientProvider';
import { addDefaultElanPath, removeElanPath, addToolchainBinPath, isElanDisabled, getDefaultLeanVersion} from './config';
import { findLeanPackageVersionInfo } from './utils/projectInfo';
import { Exports } from './exports';
import { LeanTaskProvider, leanTaskDefinition } from './tasks';
import { logger } from './utils/logger'
import { ProjectOperationProvider } from './project';

function isLean(languageId : string) : boolean {
    return languageId === 'lean' || languageId === 'lean4';
}


function getLeanDocument() : TextDocument | undefined {
    let document : TextDocument | undefined;
    if (window.activeTextEditor && isLean(window.activeTextEditor.document.languageId))
    {
        document = window.activeTextEditor.document
    } else {
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

export async function activate(context: ExtensionContext): Promise<Exports> {

    // for unit test that tests behavior when there is no elan installed.
    if (isElanDisabled()) {
        const elanRoot = removeElanPath();
        if (elanRoot){
            addToolchainBinPath(elanRoot);
        }
    } else {
        addDefaultElanPath();
    }

    const defaultToolchain = getDefaultLeanVersion();

    // note: workspace.rootPath can be undefined in the untitled or adhoc case
    // where the user ran "code lean_filename".
    const doc = getLeanDocument();
    let packageUri = null;
    let toolchainVersion = null;
    if (doc) {
        [packageUri, toolchainVersion] = await findLeanPackageVersionInfo(doc.uri);
        if (toolchainVersion && toolchainVersion.indexOf('lean:3') > 0) {
            logger.log(`Lean4 skipping lean 3 project: ${toolchainVersion}`);
            return { isLean4Project: false, version: toolchainVersion,
                infoProvider: undefined, clientProvider: undefined, installer: undefined, docView: undefined, taskProvider: undefined, projectOperationProvider: undefined };
        }
    }

    const outputChannel = window.createOutputChannel('Lean: Editor');

    const installer = new LeanInstaller(outputChannel, defaultToolchain)
    context.subscriptions.push(installer);

    const versionInfo = await installer.checkLeanVersion(packageUri, toolchainVersion??defaultToolchain)
    // Check whether rootPath is a Lean 3 project (the Lean 3 extension also uses the deprecated rootPath)
    if (versionInfo.version === '3') {
        context.subscriptions.pop()?.dispose(); // stop installer
        // We need to terminate before registering the LeanClientProvider,
        // because that class changes the document id to `lean4`.
        return { isLean4Project: false, version: '3',
            infoProvider: undefined, clientProvider: undefined, installer: undefined, docView: undefined, taskProvider: undefined, projectOperationProvider: undefined };
    }

    const pkgService = new LeanpkgService()
    context.subscriptions.push(pkgService);

    const leanClientProvider = new LeanClientProvider(installer, pkgService, outputChannel);
    context.subscriptions.push(leanClientProvider)

    const info = new InfoProvider(leanClientProvider, {language: 'lean4'}, context);
    context.subscriptions.push(info)

    const abbrev = new AbbreviationFeature();
    context.subscriptions.push(abbrev);

    const docView = new DocViewProvider(context.extensionUri);
    context.subscriptions.push(docView);

    // pass the abbreviations through to the docView so it can show them on demand.
    docView.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation);

    context.subscriptions.push(new LeanTaskGutter(leanClientProvider, context))

    pkgService.versionChanged((uri) => installer.handleVersionChanged(uri));
    pkgService.lakeFileChanged((uri) => installer.handleLakeFileChanged(uri));

    const taskProvider = new LeanTaskProvider()
    context.subscriptions.push(tasks.registerTaskProvider(leanTaskDefinition.type, taskProvider))

    const projectOperationProvider = new ProjectOperationProvider()
    context.subscriptions.push(projectOperationProvider)

    return { isLean4Project: true, version: '4',
        infoProvider: info, clientProvider: leanClientProvider, installer, docView, taskProvider, projectOperationProvider};
}
