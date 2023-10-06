import { window, ExtensionContext, TextDocument, tasks, commands, Disposable } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { InfoProvider } from './infoview'
import { DocViewProvider } from './docview'
import { LeanTaskGutter } from './taskgutter'
import { LeanInstaller } from './utils/leanInstaller'
import { LeanpkgService } from './utils/leanpkg'
import { LeanClientProvider } from './utils/clientProvider'
import { addDefaultElanPath, removeElanPath, addToolchainBinPath, isElanDisabled, getDefaultLeanVersion} from './config'
import { findLeanPackageVersionInfo } from './utils/projectInfo'
import { Exports } from './exports';
import { logger } from './utils/logger'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'

interface AlwaysEnabledFeatures {
    docView: DocViewProvider
    projectInitializationProvider: ProjectInitializationProvider
    installer: LeanInstaller
}

interface Lean4EnabledFeatures {
    clientProvider: LeanClientProvider
    infoProvider: InfoProvider
    projectOperationProvider: ProjectOperationProvider
}

function isLean(languageId : string) : boolean {
    return languageId === 'lean' || languageId === 'lean4';
}

function findOpenLeanDocument() : TextDocument | undefined {
    const activeEditor = window.activeTextEditor
    if (activeEditor && isLean(activeEditor.document.languageId)) {
        return activeEditor.document
    }

    // This happens if vscode starts with a lean file open
    // but the "Getting Started" page is active.
    for (const editor of window.visibleTextEditors) {
        if (isLean(editor.document.languageId)) {
            return editor.document
        }
    }

    return undefined;
}

/**
 * Activates all extension features that are *always* enabled, even when no Lean 4 document is currently open.
 */
function activateAlwaysEnabledFeatures(context: ExtensionContext): AlwaysEnabledFeatures {
    // For unit test that tests behavior when there is no elan installed.
    if (isElanDisabled()) {
        const elanRoot = removeElanPath();
        if (elanRoot){
            addToolchainBinPath(elanRoot);
        }
    } else {
        addDefaultElanPath();
    }

    context.subscriptions.push(commands.registerCommand('lean4.setup.showSetupGuide', async () => {
        if (process.platform === 'win32') {
            await commands.executeCommand('workbench.action.openWalkthrough', 'leanprover.lean4#guide.windows', false)
        } else if (process.platform === 'darwin') {
            await commands.executeCommand('workbench.action.openWalkthrough', 'leanprover.lean4#guide.mac', false)
        } else if (process.platform === 'linux') {
            await commands.executeCommand('workbench.action.openWalkthrough', 'leanprover.lean4#guide.linux', false)
        } else {
            await commands.executeCommand('workbench.action.openWalkthrough', 'leanprover.lean4#guide.linux', false)
        }
    }))

    const docView = new DocViewProvider(context.extensionUri);
    context.subscriptions.push(docView);

    const outputChannel = window.createOutputChannel('Lean: Editor');
    context.subscriptions.push(commands.registerCommand('lean4.showOutput', () => outputChannel.show(true)))

    const projectInitializationProvider = new ProjectInitializationProvider(outputChannel)
    context.subscriptions.push(projectInitializationProvider)

    const defaultToolchain = getDefaultLeanVersion();
    const installer = new LeanInstaller(outputChannel, defaultToolchain)

    return { docView, projectInitializationProvider, installer }
}

async function isLean3Project(installer: LeanInstaller): Promise<boolean> {
    const doc = findOpenLeanDocument();

    const [packageUri, toolchainVersion] = doc
        ? await findLeanPackageVersionInfo(doc.uri)
        : [null, null]

    if (toolchainVersion && toolchainVersion.indexOf('lean:3') > 0) {
        logger.log(`Lean4 skipping lean 3 project: ${toolchainVersion}`);
        return true
    }

    const versionInfo = await installer.checkLeanVersion(packageUri, toolchainVersion ?? installer.getDefaultToolchain())
    if (versionInfo.version === '3') {
        return true
    }

    return false
}

function activateAbbreviationFeature(context: ExtensionContext, docView: DocViewProvider): AbbreviationFeature {
    const abbrev = new AbbreviationFeature();
    // Pass the abbreviations through to the docView so it can show them on demand.
    docView.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation);
    context.subscriptions.push(abbrev);
    return abbrev
}

function activateLean4Features(context: ExtensionContext, installer: LeanInstaller): Lean4EnabledFeatures {
    const pkgService = new LeanpkgService()
    pkgService.versionChanged((uri) => installer.handleVersionChanged(uri));
    pkgService.lakeFileChanged((uri) => installer.handleLakeFileChanged(uri));
    context.subscriptions.push(pkgService);

    const clientProvider = new LeanClientProvider(installer, pkgService, installer.getOutputChannel());
    context.subscriptions.push(clientProvider)

    const infoProvider = new InfoProvider(clientProvider, {language: 'lean4'}, context);
    context.subscriptions.push(infoProvider)

    context.subscriptions.push(new LeanTaskGutter(clientProvider, context))

    const projectOperationProvider: ProjectOperationProvider = new ProjectOperationProvider(installer.getOutputChannel(), clientProvider)

    return { clientProvider, infoProvider, projectOperationProvider }
}

export async function activate(context: ExtensionContext): Promise<Exports> {
    const alwaysEnabledFeatures: AlwaysEnabledFeatures = activateAlwaysEnabledFeatures(context)

    if (await isLean3Project(alwaysEnabledFeatures.installer)) {
        return {
            isLean4Project: false,
            version: '3',
            infoProvider: undefined,
            clientProvider: undefined,
            projectOperationProvider: undefined,
            installer: alwaysEnabledFeatures.installer,
            docView: alwaysEnabledFeatures.docView,
            projectInitializationProver: alwaysEnabledFeatures.projectInitializationProvider
        }
    }

    activateAbbreviationFeature(context, alwaysEnabledFeatures.docView)

    if (findOpenLeanDocument()) {
        const lean4EnabledFeatures: Lean4EnabledFeatures = activateLean4Features(context, alwaysEnabledFeatures.installer)
        return {
            isLean4Project: true,
            version: '4',
            infoProvider: lean4EnabledFeatures.infoProvider,
            clientProvider: lean4EnabledFeatures.clientProvider,
            projectOperationProvider: lean4EnabledFeatures.projectOperationProvider,
            installer: alwaysEnabledFeatures.installer,
            docView: alwaysEnabledFeatures.docView,
            projectInitializationProver: alwaysEnabledFeatures.projectInitializationProvider
        }
    }

    // No Lean 4 document yet => Load remaining features when one is open
    const disposeActivationListener: Disposable = window.onDidChangeVisibleTextEditors(_ => {
        if (findOpenLeanDocument()) {
            activateLean4Features(context, alwaysEnabledFeatures.installer)
            disposeActivationListener.dispose()
        }
    }, context.subscriptions)

    return {
        isLean4Project: false,
        version: undefined,
        infoProvider: undefined,
        clientProvider: undefined,
        projectOperationProvider: undefined,
        installer: alwaysEnabledFeatures.installer,
        docView: alwaysEnabledFeatures.docView,
        projectInitializationProver: alwaysEnabledFeatures.projectInitializationProvider
    }
}
