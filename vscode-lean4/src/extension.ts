import { commands, Disposable, ExtensionContext, extensions, TextDocument, window, workspace } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import {
    addDefaultElanPath,
    addToolchainBinPath,
    getDefaultElanPath,
    getDefaultLeanVersion,
    isElanDisabled,
    removeElanPath,
} from './config'
import { DocViewProvider } from './docview'
import { AlwaysEnabledFeatures, Exports, Lean4EnabledFeatures } from './exports'
import { InfoProvider } from './infoview'
import { LeanClient } from './leanclient'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'
import { LeanTaskGutter } from './taskgutter'
import { LeanClientProvider } from './utils/clientProvider'
import { LeanConfigWatchService } from './utils/configwatchservice'
import { isExtUri } from './utils/exturi'
import { LeanInstaller } from './utils/leanInstaller'

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

/**
 * Activates all extension features that are *always* enabled, even when no Lean 4 document is currently open.
 */
function activateAlwaysEnabledFeatures(context: ExtensionContext): AlwaysEnabledFeatures {
    // For unit test that tests behavior when there is no elan installed.
    if (isElanDisabled()) {
        const elanRoot = removeElanPath()
        if (elanRoot) {
            addToolchainBinPath(elanRoot)
        }
    } else {
        addDefaultElanPath()
    }

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

    const projectInitializationProvider = new ProjectInitializationProvider(outputChannel)
    context.subscriptions.push(projectInitializationProvider)
    const defaultToolchain = getDefaultLeanVersion()

    const installer = new LeanInstaller(outputChannel, defaultToolchain)

    context.subscriptions.push(
        commands.registerCommand('lean4.setup.installElan', async () => {
            await installer.installElan()
            if (isElanDisabled()) {
                addToolchainBinPath(getDefaultElanPath())
            } else {
                addDefaultElanPath()
            }
        }),
    )

    const checkForExtensionConflict = (doc: TextDocument) => {
        const isLean3ExtensionInstalled = extensions.getExtension('jroesch.lean') !== undefined
        if (isLean3ExtensionInstalled && (doc.languageId === 'lean' || doc.languageId === 'lean4')) {
            void window.showWarningMessage(
                "The Lean 3 and the Lean 4 VS Code extension are enabled at the same time. Since both extensions act on .lean files, this can lead to issues with either extension. Please disable the extension for the Lean major version that you do not want to use ('Extensions' in the left sidebar > Cog icon > 'Disable').",
            )
        }
    }
    for (const doc of workspace.textDocuments) {
        checkForExtensionConflict(doc)
    }
    context.subscriptions.push(workspace.onDidOpenTextDocument(checkForExtensionConflict))

    return { docView, projectInitializationProvider, outputChannel, installer }
}

function activateAbbreviationFeature(context: ExtensionContext, docView: DocViewProvider): AbbreviationFeature {
    const abbrev = new AbbreviationFeature()
    // Pass the abbreviations through to the docView so it can show them on demand.
    docView.setAbbreviations(abbrev.abbreviations.symbolsByAbbreviation)
    context.subscriptions.push(abbrev)
    return abbrev
}

async function activateLean4Features(
    context: ExtensionContext,
    installer: LeanInstaller,
): Promise<Lean4EnabledFeatures> {
    const clientProvider = new LeanClientProvider(installer, installer.getOutputChannel())
    context.subscriptions.push(clientProvider)

    const watchService = new LeanConfigWatchService()
    watchService.versionChanged(async packageUri => {
        const client: LeanClient | undefined = clientProvider.getClientForFolder(packageUri)
        if (client && !client.isRunning()) {
            // This can naturally happen when we update the Lean version using the "Update Dependency" command
            // because the Lean server is stopped while doing so. We want to avoid triggering the "Version changed"
            // message in this case.
            return
        }
        await installer.handleVersionChanged(packageUri)
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

    return {
        ...alwaysEnabledFeatures,
        activatedLean4Features: new Promise(async (resolve, _) => {
            const doc: TextDocument | undefined = findOpenLeanDocument()
            if (doc) {
                const lean4EnabledFeatures: Lean4EnabledFeatures = await activateLean4Features(
                    context,
                    alwaysEnabledFeatures.installer,
                )
                resolve(lean4EnabledFeatures)
            } else {
                // No Lean 4 document yet => Load remaining features when one is open
                const disposeActivationListener: Disposable = workspace.onDidOpenTextDocument(async doc => {
                    if (isLean4Document(doc)) {
                        const lean4EnabledFeatures: Lean4EnabledFeatures = await activateLean4Features(
                            context,
                            alwaysEnabledFeatures.installer,
                        )
                        resolve(lean4EnabledFeatures)
                        disposeActivationListener.dispose()
                    }
                }, context.subscriptions)
            }
        }),
    }
}
