import { SemVer } from 'semver'
import { OutputChannel, commands } from 'vscode'
import { ExtUri, FileUri, extUriToCwdUri } from '../utils/exturi'
import { displayInternalError } from '../utils/internalErrors'
import { ToolchainUpdateMode } from '../utils/leanCmdRunner'
import { LeanInstaller } from '../utils/leanInstaller'
import { diagnose } from './setupDiagnoser'
import {
    PreconditionCheckResult,
    SetupNotificationOptions,
    SetupNotifier,
    worstPreconditionViolation,
} from './setupNotifs'

const singleFileWarningMessage = `Lean 4 server is operating in restricted single file mode.
Please open a valid Lean 4 project containing a \'lean-toolchain\' file for full functionality.
Click the following link to learn how to set up or open Lean projects: [(Show Setup Guide)](command:lean4.docs.showSetupGuide)`

const missingLeanToolchainWarningMessage = `Opened folder does not contain a valid Lean 4 project.
Please open a valid Lean 4 project containing a \'lean-toolchain\' file for full functionality.
Click the following link to learn how to set up or open Lean projects: [(Show Setup Guide)](command:lean4.docs.showSetupGuide)`

const missingLeanToolchainWithParentProjectWarningMessage = (parentProjectFolder: FileUri) =>
    `Opened folder does not contain a valid Lean 4 project folder because it does not contain a 'lean-toolchain' file.
However, a valid Lean 4 project folder was found in one of the parent directories at '${parentProjectFolder.fsPath}'.
Open this project instead?`

const lean3ProjectErrorMessage = (origin: string, projectVersion: SemVer) =>
    `${origin} is using Lean 3 (version: ${projectVersion.toString()}).
If you want to use Lean 3, disable this extension ('Extensions' in the left sidebar > Cog icon on 'lean4' > 'Disable') and install the 'lean' extension for Lean 3 support.`

const ancientLean4ProjectWarningMessage = (origin: string, projectVersion: SemVer) =>
    `${origin} is using a Lean 4 version (${projectVersion.toString()}) from before the first Lean 4 stable release (4.0.0).
Pre-stable Lean 4 versions are increasingly less supported, so please consider updating to a newer Lean 4 version.`

const oldServerFolderContainsNewServerFolderErrorMessage = (
    folderUri: FileUri,
    fileUri: FileUri,
    clientFolderUri: FileUri,
) =>
    `Error while starting language server: The project at '${folderUri.fsPath}' of the file '${fileUri.baseName()}' is contained inside of another project at '${clientFolderUri.fsPath}', for which a language server is already running.
The Lean 4 VS Code extension does not support nested Lean projects.`

const newServerFolderContainsOldServerFolderErrorMessage = (
    folderUri: FileUri,
    fileUri: FileUri,
    clientFolderUri: FileUri,
) =>
    `Error while starting language server: The project at '${folderUri.fsPath}' of the file '${fileUri.baseName()}' contains another project at '${clientFolderUri.fsPath}', for which a language server is already running.
The Lean 4 VS Code extension does not support nested Lean projects.`

export class SetupDiagnostics {
    private n: SetupNotifier

    constructor(o: SetupNotificationOptions) {
        this.n = new SetupNotifier(o)
    }

    async checkAreDependenciesInstalled(
        channel: OutputChannel,
        cwdUri: FileUri | undefined,
    ): Promise<PreconditionCheckResult> {
        const missingDeps = []
        if (!(await diagnose({ channel, cwdUri }).checkCurlAvailable())) {
            missingDeps.push('curl')
        }
        if (!(await diagnose({ channel, cwdUri }).checkGitAvailable())) {
            missingDeps.push('git')
        }
        if (missingDeps.length === 0) {
            return 'Fulfilled'
        }
        let missingDepMessage: string
        if (missingDeps.length === 1) {
            missingDepMessage = `One of Lean's dependencies ('${missingDeps.at(0)}') is missing`
        } else {
            missingDepMessage = `Multiple of Lean's dependencies (${missingDeps.map(dep => `'${dep}'`).join(', ')}) are missing`
        }

        const errorMessage = `${missingDepMessage}. Please read the Setup Guide on how to install missing dependencies and set up Lean 4.`
        return await this.n.displaySetupErrorWithSetupGuide(errorMessage)
    }

    async checkIsLean4Installed(
        installer: LeanInstaller,
        context: string,
        cwdUri: FileUri | undefined,
        toolchainUpdateMode: ToolchainUpdateMode,
    ): Promise<PreconditionCheckResult> {
        const leanVersionResult = await diagnose({
            channel: installer.getOutputChannel(),
            cwdUri,
            context,
            toolchainUpdateMode,
        }).queryLeanVersion()
        switch (leanVersionResult.kind) {
            case 'Success':
                return 'Fulfilled'

            case 'CommandError':
                return this.n.displaySetupErrorWithOutput(
                    `Error while checking Lean version: ${leanVersionResult.message}`,
                )

            case 'Cancelled':
                return this.n.displaySetupErrorWithOutput('Error while checking Lean version: Operation cancelled.')

            case 'InvalidVersion':
                return this.n.displaySetupErrorWithOutput(
                    `Error while checking Lean version: 'lean --version' returned a version that could not be parsed: '${leanVersionResult.versionResult}'`,
                )

            case 'CommandNotFound':
                return await this.n.displayElanSetupError(installer, 'Lean is not installed.')
        }
    }

    async checkIsElanUpToDate(
        installer: LeanInstaller,
        cwdUri: FileUri | undefined,
        options: { elanMustBeInstalled: boolean },
    ): Promise<PreconditionCheckResult> {
        const elanDiagnosis = await diagnose({ channel: installer.getOutputChannel(), cwdUri }).elanVersion()

        switch (elanDiagnosis.kind) {
            case 'NotInstalled':
                if (options.elanMustBeInstalled) {
                    return await this.n.displayElanSetupError(
                        installer,
                        "Lean's version manager Elan is not installed.",
                    )
                }
                return await this.n.displayElanSetupWarning(
                    installer,
                    "Lean's version manager Elan is not installed. This means that the correct Lean 4 toolchain version of Lean 4 projects will not be selected or installed automatically.",
                )

            case 'ExecutionError':
                return await this.n.displaySetupWarningWithOutput(
                    'Cannot determine Elan version: ' + elanDiagnosis.message,
                )

            case 'Outdated':
                return await this.n.displayElanOutdatedSetupWarning(
                    installer,
                    elanDiagnosis.currentVersion,
                    elanDiagnosis.recommendedVersion,
                )

            case 'UpToDate':
                return 'Fulfilled'
        }
    }

    async checkIsValidProjectFolder(channel: OutputChannel, folderUri: ExtUri): Promise<PreconditionCheckResult> {
        const projectSetupDiagnosis = await diagnose({ channel, cwdUri: extUriToCwdUri(folderUri) }).projectSetup()
        switch (projectSetupDiagnosis.kind) {
            case 'SingleFile':
                return await this.n.displaySetupWarning(singleFileWarningMessage)

            case 'MissingLeanToolchain':
                const parentProjectFolder = projectSetupDiagnosis.parentProjectFolder
                if (parentProjectFolder === undefined) {
                    return await this.n.displaySetupWarning(missingLeanToolchainWarningMessage)
                } else {
                    return this.n.displaySetupWarningWithInput(
                        missingLeanToolchainWithParentProjectWarningMessage(parentProjectFolder),
                        [
                            {
                                input: 'Open Parent Directory Project',
                                // this kills the extension host
                                action: () => commands.executeCommand('vscode.openFolder', parentProjectFolder),
                            },
                        ],
                    )
                }

            case 'ValidProjectSetup':
                return 'Fulfilled'
        }
    }

    async checkIsNestedProjectFolder(
        existingFolderUris: ExtUri[],
        folderUri: ExtUri,
        fileUri: ExtUri,
        stopOtherServer: (folderUri: FileUri) => Promise<void>,
    ): Promise<PreconditionCheckResult> {
        if (folderUri.scheme === 'untitled' || fileUri.scheme === 'untitled') {
            if (existingFolderUris.some(existingFolderUri => existingFolderUri.scheme === 'untitled')) {
                await displayInternalError(
                    'starting language server',
                    'Attempting to start new untitled language server while one already exists.',
                )
                return 'Fatal'
            }
            return 'Fulfilled'
        }

        for (const existingFolderUri of existingFolderUris) {
            if (existingFolderUri.scheme !== 'file') {
                continue
            }
            if (existingFolderUri.isInFolder(folderUri)) {
                return await this.n.displaySetupErrorWithInput(
                    newServerFolderContainsOldServerFolderErrorMessage(folderUri, fileUri, existingFolderUri),
                    [
                        {
                            input: 'Stop Other Server',
                            continueDisplaying: false,
                            action: () => stopOtherServer(existingFolderUri),
                        },
                    ],
                )
            }
            if (folderUri.isInFolder(existingFolderUri)) {
                return await this.n.displaySetupErrorWithInput(
                    oldServerFolderContainsNewServerFolderErrorMessage(folderUri, fileUri, existingFolderUri),
                    [
                        {
                            input: 'Stop Other Server',
                            continueDisplaying: false,
                            action: () => stopOtherServer(existingFolderUri),
                        },
                    ],
                )
            }
        }

        return 'Fulfilled'
    }

    async checkIsLeanVersionUpToDate(
        channel: OutputChannel,
        context: string,
        folderUri: ExtUri,
        options: { toolchainOverride?: string | undefined; toolchainUpdateMode: ToolchainUpdateMode },
    ): Promise<PreconditionCheckResult> {
        let origin: string
        if (options.toolchainOverride !== undefined) {
            origin = `Project toolchain '${options.toolchainOverride}'`
        } else if (folderUri.scheme === 'untitled') {
            origin = 'Opened file'
        } else {
            origin = 'Opened project'
        }
        const projectLeanVersionDiagnosis = await diagnose({
            channel,
            cwdUri: extUriToCwdUri(folderUri),
            toolchain: options.toolchainOverride,
            context,
            toolchainUpdateMode: options.toolchainUpdateMode,
        }).leanVersion()
        switch (projectLeanVersionDiagnosis.kind) {
            case 'NotInstalled':
                return this.n.displaySetupErrorWithOutput(
                    "Error while checking Lean version: 'lean' command was not found.",
                )

            case 'ExecutionError':
                return this.n.displaySetupErrorWithOutput(
                    `Error while checking Lean version: ${projectLeanVersionDiagnosis.message}`,
                )

            case 'Cancelled':
                return this.n.displaySetupErrorWithOutput('Error while checking Lean version: Operation cancelled.')

            case 'IsLean3Version':
                return this.n.displaySetupError(lean3ProjectErrorMessage(origin, projectLeanVersionDiagnosis.version))

            case 'IsAncientLean4Version':
                return await this.n.displaySetupWarning(
                    ancientLean4ProjectWarningMessage(origin, projectLeanVersionDiagnosis.version),
                )

            case 'UpToDate':
                return 'Fulfilled'
        }
    }

    async checkIsLakeInstalledCorrectly(
        channel: OutputChannel,
        context: string,
        folderUri: ExtUri,
        options: { toolchainOverride?: string | undefined; toolchainUpdateMode: ToolchainUpdateMode },
    ): Promise<PreconditionCheckResult> {
        const lakeAvailabilityResult = await diagnose({
            channel,
            cwdUri: extUriToCwdUri(folderUri),
            toolchain: options.toolchainOverride,
            context,
            toolchainUpdateMode: options.toolchainUpdateMode,
        }).checkLakeAvailable()
        switch (lakeAvailabilityResult.kind) {
            case 'NotAvailable':
                return this.n.displaySetupErrorWithOutput(
                    "Error while checking Lake availability: 'lake' command was not found.",
                )

            case 'Error':
                return this.n.displaySetupErrorWithOutput(
                    `Error while checking Lake availability: ${lakeAvailabilityResult.message}`,
                )

            case 'Cancelled':
                return this.n.displaySetupErrorWithOutput(
                    'Error while checking Lake availability: Operation cancelled.',
                )

            case 'Available':
                return 'Fulfilled'
        }
    }

    async checkIsVSCodeUpToDate(): Promise<PreconditionCheckResult> {
        const vscodeVersionResult = diagnose({ channel: undefined, cwdUri: undefined }).queryVSCodeVersion()
        switch (vscodeVersionResult.kind) {
            case 'Outdated':
                return await this.n.displaySetupWarning(
                    `VS Code version is too out-of-date for new versions of the Lean 4 VS Code extension. The current VS Code version is ${vscodeVersionResult.currentVersion}, but a version of at least ${vscodeVersionResult.recommendedVersion} is recommended so that new versions of the Lean 4 VS Code extension can be installed.`,
                )

            case 'UpToDate':
                return 'Fulfilled'
        }
    }
}

export async function checkAll(
    ...checks: (() => Promise<PreconditionCheckResult>)[]
): Promise<PreconditionCheckResult> {
    let worstViolation: PreconditionCheckResult = 'Fulfilled'
    for (const check of checks) {
        const result = await check()
        worstViolation = worstPreconditionViolation(worstViolation, result)
        if (worstViolation === 'Fatal') {
            return 'Fatal'
        }
    }
    return worstViolation
}
