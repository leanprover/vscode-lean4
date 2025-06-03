import * as os from 'os'
import * as path from 'path'
import { commands, ExtensionContext, extensions, TextDocument, window, workspace } from 'vscode'
import { AbbreviationFeature } from './abbreviation/AbbreviationFeature'
import { AbbreviationView } from './abbreviationview'
import { getDefaultLeanVersion } from './config'
import { FullDiagnosticsProvider } from './diagnostics/fullDiagnostics'
import { checkAll, SetupDiagnostics } from './diagnostics/setupDiagnostics'
import { PreconditionCheckResult, SetupNotificationOptions } from './diagnostics/setupNotifs'
import { AlwaysEnabledFeatures, Exports, Lean4EnabledFeatures } from './exports'
import { InfoProvider } from './infoview'
import { LeanClient } from './leanclient'
import { LoogleView } from './loogleview'
import { ManualView } from './manualview'
import { MoogleView } from './moogleview'
import { ProjectInitializationProvider } from './projectinit'
import { ProjectOperationProvider } from './projectoperations'
import { LeanTaskGutter } from './taskgutter'
import { LeanClientProvider } from './utils/clientProvider'
import { LeanConfigWatchService } from './utils/configwatchservice'
import { ElanCommandProvider } from './utils/elanCommands'
import { PATH, setProcessEnvPATH } from './utils/envPath'
import { onEventWhile, withoutReentrancy } from './utils/events'
import { ExtUri, extUriToCwdUri, FileUri } from './utils/exturi'
import { displayInternalErrorsIn } from './utils/internalErrors'
import { registerLeanCommandRunner } from './utils/leanCmdRunner'
import { lean, registerLeanEditorProvider } from './utils/leanEditorProvider'
import { LeanInstaller } from './utils/leanInstaller'
import { ModuleTreeViewProvider } from './utils/moduleTreeViewProvider'
import {
    displayActiveStickyNotification,
    displayModalNotification,
    displayNotification,
    setStickyNotificationActiveButHidden,
} from './utils/notifs'
import { PathExtensionProvider } from './utils/pathExtensionProvider'
import { findLeanProjectRootInfo } from './utils/projectInfo'
import { UriHandlerService } from './utils/uriHandlerService'

async function setLeanFeatureSetActive(isActive: boolean) {
    await commands.executeCommand('setContext', 'lean4.isLeanFeatureSetActive', isActive)
}

async function findOpenLeanProjectUri(): Promise<ExtUri | 'NoValidDocument'> {
    const activeEditor = lean.activeLeanEditor
    if (activeEditor !== undefined) {
        const info = await findLeanProjectRootInfo(activeEditor.documentExtUri)
        if (info.kind !== 'FileNotFound') {
            return info.projectRootUri
        }
    }

    // This happens if vscode starts with a lean file open
    // but the "Getting Started" page is active.
    for (const editor of lean.visibleLeanEditors) {
        const info = await findLeanProjectRootInfo(editor.documentExtUri)
        if (info.kind !== 'FileNotFound') {
            return info.projectRootUri
        }
    }

    return 'NoValidDocument'
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
        commands.registerCommand('lean4.docs.showSetupGuide', () =>
            commands.executeCommand('workbench.action.openWalkthrough', 'leanprover.lean4#lean4.welcome', false),
        ),
        commands.registerCommand('lean4.troubleshooting.showTroubleshootingGuide', () =>
            commands.executeCommand(
                'workbench.action.openWalkthrough',
                { category: 'leanprover.lean4#lean4.welcome', step: 'lean4.welcome.help' },
                false,
            ),
        ),
        commands.registerCommand('lean4.docs.showDocResources', () =>
            commands.executeCommand('simpleBrowser.show', 'https://lean-lang.org/documentation/'),
        ),
    )

    const extensionPath = new FileUri(context.extensionPath)
    const manualView = new ManualView(extensionPath, extensionPath.join('manual', 'manual.md'))
    context.subscriptions.push(manualView)

    const loogleView = new LoogleView(extensionPath, context.extension.packageJSON.version)
    context.subscriptions.push(loogleView)

    const moogleView = new MoogleView(extensionPath, context.extension.packageJSON.version)
    context.subscriptions.push(moogleView)

    const outputChannel = window.createOutputChannel('Lean: Editor')
    context.subscriptions.push(
        commands.registerCommand('lean4.troubleshooting.showOutput', () => outputChannel.show(true)),
    )

    const defaultToolchain = getDefaultLeanVersion()
    const installer = new LeanInstaller(outputChannel, defaultToolchain)
    context.subscriptions.push(
        commands.registerCommand(
            'lean4.setup.installElan',
            async () => await installer.displayInstallElanPrompt('Information', undefined),
        ),
        commands.registerCommand('lean4.setup.updateElan', async () => await installer.displayManualUpdateElanPrompt()),
        commands.registerCommand('lean4.setup.uninstallElan', async () => await installer.uninstallElan()),
    )

    const projectInitializationProvider = new ProjectInitializationProvider(outputChannel, installer)
    context.subscriptions.push(projectInitializationProvider)

    const checkForExtensionConflict = (doc: TextDocument) => {
        const isLean3ExtensionInstalled = extensions.getExtension('jroesch.lean') !== undefined
        if (isLean3ExtensionInstalled && (doc.languageId === 'lean' || doc.languageId === 'lean4')) {
            displayNotification(
                'Error',
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

    const abbreviationFeature = new AbbreviationFeature(outputChannel)
    context.subscriptions.push(abbreviationFeature)

    const abbreviationView = new AbbreviationView(extensionPath, abbreviationFeature.abbreviations)
    context.subscriptions.push(abbreviationView)

    const elanCommandProvider = new ElanCommandProvider(outputChannel)
    context.subscriptions.push(elanCommandProvider)

    const uriHandlerService = new UriHandlerService()
    context.subscriptions.push(uriHandlerService)

    return { projectInitializationProvider, outputChannel, installer, fullDiagnosticsProvider, elanCommandProvider }
}

async function checkLean4FeaturePreconditions(
    installer: LeanInstaller,
    context: string,
    cwdUri: FileUri | undefined,
    d: SetupDiagnostics,
): Promise<PreconditionCheckResult> {
    return await checkAll(
        () => d.checkAreDependenciesInstalled(installer.getOutputChannel(), cwdUri),
        () => d.checkIsLean4Installed(installer, context, cwdUri, 'PromptAboutUpdate'),
        () =>
            d.checkIsElanUpToDate(installer, cwdUri, {
                elanMustBeInstalled: false,
            }),
        () => d.checkIsVSCodeUpToDate(),
    )
}

async function activateLean4Features(
    context: ExtensionContext,
    installer: LeanInstaller,
    elanCommandProvider: ElanCommandProvider,
): Promise<Lean4EnabledFeatures> {
    const clientProvider = new LeanClientProvider(installer, installer.getOutputChannel())
    elanCommandProvider.setClientProvider(clientProvider)
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

    const infoProvider = new InfoProvider(clientProvider, context)
    context.subscriptions.push(infoProvider)

    context.subscriptions.push(new LeanTaskGutter(clientProvider, context))

    const projectOperationProvider: ProjectOperationProvider = new ProjectOperationProvider(
        installer.getOutputChannel(),
        clientProvider,
    )

    context.subscriptions.push(await ModuleTreeViewProvider.init(clientProvider))

    await setLeanFeatureSetActive(true)

    return { clientProvider, infoProvider, projectOperationProvider }
}

async function tryActivatingLean4FeaturesInProject(
    context: ExtensionContext,
    installer: LeanInstaller,
    elanCommandProvider: ElanCommandProvider,
    resolve: (value: Lean4EnabledFeatures) => void,
    d: SetupDiagnostics,
    projectUri: ExtUri,
) {
    const preconditionCheckResult = await checkLean4FeaturePreconditions(
        installer,
        'Activate Lean 4 Extension',
        extUriToCwdUri(projectUri),
        d,
    )
    if (preconditionCheckResult === 'Fatal') {
        return
    }
    const lean4EnabledFeatures: Lean4EnabledFeatures = await displayInternalErrorsIn('activating Lean 4 features', () =>
        activateLean4Features(context, installer, elanCommandProvider),
    )
    resolve(lean4EnabledFeatures)
}

async function tryActivatingLean4Features(
    context: ExtensionContext,
    installer: LeanInstaller,
    elanCommandProvider: ElanCommandProvider,
    resolve: (value: Lean4EnabledFeatures) => void,
    d: SetupDiagnostics,
    warnAboutNoValidDocument: boolean,
) {
    const projectUri = await findOpenLeanProjectUri()
    if (projectUri !== 'NoValidDocument') {
        await tryActivatingLean4FeaturesInProject(context, installer, elanCommandProvider, resolve, d, projectUri)
        return
    }
    if (warnAboutNoValidDocument) {
        await displayModalNotification(
            'Error',
            'No visible Lean document - cannot retry activating the extension. Please select a Lean document.',
        )
    }
    context.subscriptions.push(
        onEventWhile(
            lean.onDidRevealLeanEditor,
            withoutReentrancy('Continue', async editor => {
                const info = await findLeanProjectRootInfo(editor.documentExtUri)
                if (info.kind === 'FileNotFound') {
                    return 'Continue'
                }
                await tryActivatingLean4FeaturesInProject(
                    context,
                    installer,
                    elanCommandProvider,
                    resolve,
                    d,
                    info.projectRootUri,
                )
                return 'Stop'
            }),
        ),
    )
}

export async function activate(context: ExtensionContext): Promise<Exports> {
    await setLeanFeatureSetActive(false)
    registerLeanEditorProvider(context)
    await setStickyNotificationActiveButHidden(false)
    context.subscriptions.push(
        commands.registerCommand('lean4.redisplaySetupError', async () => displayActiveStickyNotification()),
    )
    registerLeanCommandRunner(context)

    const alwaysEnabledFeatures: AlwaysEnabledFeatures = await displayInternalErrorsIn(
        'activating Lean 4 extension',
        async () => activateAlwaysEnabledFeatures(context),
    )

    const lean4EnabledFeatures: Promise<Lean4EnabledFeatures> = new Promise(async (resolve, _) => {
        // eslint-disable-next-line prefer-const
        let d: SetupDiagnostics
        const options: SetupNotificationOptions = {
            errorMode: {
                mode: 'Sticky',
                retry: async () =>
                    tryActivatingLean4Features(
                        context,
                        alwaysEnabledFeatures.installer,
                        alwaysEnabledFeatures.elanCommandProvider,
                        resolve,
                        d,
                        true,
                    ),
            },
            warningMode: { modal: true, proceedByDefault: true },
        }
        d = new SetupDiagnostics(options)
        await tryActivatingLean4Features(
            context,
            alwaysEnabledFeatures.installer,
            alwaysEnabledFeatures.elanCommandProvider,
            resolve,
            d,
            false,
        )
    })

    return new Exports(alwaysEnabledFeatures, lean4EnabledFeatures)
}
