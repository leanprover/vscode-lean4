import * as os from 'os'
import * as path from 'path'
import { commands, Disposable, ExtensionContext, extensions, TextDocument, window, workspace } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { getDefaultLeanVersion } from './config'
import { FullDiagnosticsProvider } from './diagnostics/fullDiagnostics'
import {
    checkAll,
    checkAreDependenciesInstalled,
    checkIsElanUpToDate,
    checkIsLean4Installed,
} from './diagnostics/setupDiagnostics'
import { PreconditionCheckResult } from './diagnostics/setupNotifs'
import { DocViewProvider } from './docview'
import { AlwaysEnabledFeatures, Exports, Lean4EnabledFeatures } from './exports'
import { InfoProvider } from './infoview'
import { LeanClient } from './leanclient'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'
import { LeanTaskGutter } from './taskgutter'
import { LeanClientProvider } from './utils/clientProvider'
import { LeanConfigWatchService } from './utils/configwatchservice'
import { PATH, setProcessEnvPATH } from './utils/envPath'
import { FileUri, isExtUri, toExtUriOrError } from './utils/exturi'
import { LeanInstaller } from './utils/leanInstaller'
import { displayWarning } from './utils/notifs'
import { PathExtensionProvider } from './utils/pathExtensionProvider'
import { findLeanProjectRoot } from './utils/projectInfo'

async function setLeanFeatureSetActive(isActive: boolean) {
    await commands.executeCommand('setContext', 'lean4.isLeanFeatureSetActive', isActive)
}

function isLean4Document(doc: TextDocument): boolean {
    return isExtUri(doc.uri) && doc.languageId === 'lean4'
}

function findOpenLeanDocument(): TextDocument | undefined {
    const activeEditor = window.activeTextEditor
    if (activeEditor && isLean4Document(activeEditor.document)) {
        return activeEditor.document
    }

    // This happens if vscode starts with a lean file open
    // but the "Getting Started" page is active.
    for (const editor of window.visibleTextEditors) {
        if (isLean4Document(editor.document)) {
            return editor.document
        }
    }

    return undefined
}

function getElanPath(): string {
    return path.join(os.homedir(), '.elan', 'bin')
}

function addElanPathToPATH() {
    const path = PATH.ofProcessEnv()
    const elanPath = getElanPath()
    if (!path.includes(elanPath)) {
        setProcessEnvPATH(path.prepend(elanPath))
    }
}

/**
 * Activates all extension features that are *always* enabled, even when no Lean 4 document is currently open.
 */
function activateAlwaysEnabledFeatures(context: ExtensionContext): AlwaysEnabledFeatures {
    addElanPathToPATH()
    context.subscriptions.push(PathExtensionProvider.withAddedEnvPathExtensions())

    context.subscriptions.push(
        commands.registerCommand('lean4.setup.showSetupGuide', async () =>
            commands.executeCommand('workbench.action.openWalkthrough', 'leanprover.lean4#lean4.welcome', false),
        ),
    )

    const docView = new DocViewProvider(context.extensionUri)
    context.subscriptions.push(docView)

    const outputChannel = window.createOutputChannel('Lean: Editor')
    context.subscriptions.push(
        commands.registerCommand('lean4.troubleshooting.showOutput', () => outputChannel.show(true)),
    )

    const defaultToolchain = getDefaultLeanVersion()
    const installer = new LeanInstaller(outputChannel, defaultToolchain)
    context.subscriptions.push(
        commands.registerCommand('lean4.setup.installElan', () =>
            installer.displayInstallElanPrompt('Information', undefined),
        ),
    )

    const projectInitializationProvider = new ProjectInitializationProvider(outputChannel, installer)
    context.subscriptions.push(projectInitializationProvider)

    const checkForExtensionConflict = (doc: TextDocument) => {
        const isLean3ExtensionInstalled = extensions.getExtension('jroesch.lean') !== undefined
        if (isLean3ExtensionInstalled && (doc.languageId === 'lean' || doc.languageId === 'lean4')) {
            displayWarning(
                "The Lean 3 and the Lean 4 VS Code extension are enabled at the same time. Since both extensions act on .lean files, this can lead to issues with either extension. Please disable the extension for the Lean major version that you do not want to use ('Extensions' in the left sidebar > Cog icon > 'Disable').",
            )
        }
    }
    for (const doc of workspace.textDocuments) {
        checkForExtensionConflict(doc)
    }
    context.subscriptions.push(workspace.onDidOpenTextDocument(checkForExtensionConflict))

    const fullDiagnosticsProvider = new FullDiagnosticsProvider(outputChannel)
    context.subscriptions.push(fullDiagnosticsProvider)

    return { docView, projectInitializationProvider, outputChannel, installer, fullDiagnosticsProvider }
}

function activateAbbreviationFeature(context: ExtensionContext, docView: DocViewProvider): AbbreviationFeature {
    const abbrev = new AbbreviationFeature()
    // Pass the abbreviations through to the docView so it can show them on demand.
    docView.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation)
    context.subscriptions.push(abbrev)
    return abbrev
}

async function checkLean4FeaturePreconditions(
    installer: LeanInstaller,
    cwdUri: FileUri | undefined,
): Promise<PreconditionCheckResult> {
    return await checkAll(
        () => checkAreDependenciesInstalled(installer.getOutputChannel(), cwdUri),
        () => checkIsLean4Installed(installer, cwdUri),
        () =>
            checkIsElanUpToDate(installer, cwdUri, {
                elanMustBeInstalled: false,
                modal: false,
            }),
    )
}

async function activateLean4Features(
    context: ExtensionContext,
    installer: LeanInstaller,
    doc: TextDocument,
): Promise<Lean4EnabledFeatures | undefined> {
    const docUri = toExtUriOrError(doc.uri)
    const cwd = docUri.scheme === 'file' ? await findLeanProjectRoot(docUri) : undefined
    const preconditionCheckResult = await checkLean4FeaturePreconditions(installer, cwd)
    if (preconditionCheckResult === 'Fatal') {
        return undefined
    }

    const clientProvider = new LeanClientProvider(installer, installer.getOutputChannel())
    context.subscriptions.push(clientProvider)

    const watchService = new LeanConfigWatchService()
    watchService.versionChanged(packageUri => {
        const client: LeanClient | undefined = clientProvider.getClientForFolder(packageUri)
        if (client && !client.isRunning()) {
            // This can naturally happen when we update the Lean version using the "Update Dependency" command
            // because the Lean server is stopped while doing so. We want to avoid triggering the "Version changed"
            // message in this case.
            return
        }
        installer.handleVersionChanged(packageUri)
    })
    watchService.lakeFileChanged(packageUri => installer.handleLakeFileChanged(packageUri))
    context.subscriptions.push(watchService)

    const infoProvider = new InfoProvider(clientProvider, { language: 'lean4' }, context)
    context.subscriptions.push(infoProvider)

    context.subscriptions.push(new LeanTaskGutter(clientProvider, context))

    const projectOperationProvider: ProjectOperationProvider = new ProjectOperationProvider(
        installer.getOutputChannel(),
        clientProvider,
    )

    await setLeanFeatureSetActive(true)

    return { clientProvider, infoProvider, projectOperationProvider }
}

export async function activate(context: ExtensionContext): Promise<Exports> {
    await setLeanFeatureSetActive(false)
    const alwaysEnabledFeatures: AlwaysEnabledFeatures = activateAlwaysEnabledFeatures(context)
    activateAbbreviationFeature(context, alwaysEnabledFeatures.docView)

    const lean4EnabledFeatures: Promise<Lean4EnabledFeatures> = new Promise(async (resolve, _) => {
        const doc: TextDocument | undefined = findOpenLeanDocument()
        if (doc) {
            const lean4EnabledFeatures: Lean4EnabledFeatures | undefined = await activateLean4Features(
                context,
                alwaysEnabledFeatures.installer,
                doc,
            )
            if (lean4EnabledFeatures) {
                resolve(lean4EnabledFeatures)
                return
            }
        }

        // No Lean 4 document yet => Load remaining features when one is open
        const disposeActivationListener: Disposable = workspace.onDidOpenTextDocument(async doc => {
            if (!isLean4Document(doc)) {
                return
            }
            const lean4EnabledFeatures: Lean4EnabledFeatures | undefined = await activateLean4Features(
                context,
                alwaysEnabledFeatures.installer,
                doc,
            )
            if (!lean4EnabledFeatures) {
                return
            }
            resolve(lean4EnabledFeatures)
            disposeActivationListener.dispose()
        }, context.subscriptions)
    })

    return new Exports(alwaysEnabledFeatures, lean4EnabledFeatures)
}
