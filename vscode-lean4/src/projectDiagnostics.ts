import { SemVer } from 'semver'
import { OutputChannel, commands } from 'vscode'
import { ExtUri, FileUri } from './utils/exturi'
import {
    PreconditionCheckResult,
    SetupDiagnoser,
    diagnose,
    displaySetupError,
    displaySetupErrorWithOutput,
    displaySetupWarning,
    displaySetupWarningWithOptionalInput,
    worstPreconditionViolation,
} from './utils/setupDiagnostics'

const singleFileWarningMessage = `Lean 4 server is operating in restricted single file mode.
Please open a valid Lean 4 project containing a \'lean-toolchain\' file for full functionality.
Click the following link to learn how to set up or open Lean projects: [(Show Setup Guide)](command:lean4.setup.showSetupGuide)`

const missingLeanToolchainWarningMessage = `Opened folder does not contain a valid Lean 4 project.
Please open a valid Lean 4 project containing a \'lean-toolchain\' file for full functionality.
Click the following link to learn how to set up or open Lean projects: [(Show Setup Guide)](command:lean4.setup.showSetupGuide)`

const missingLeanToolchainWithParentProjectWarningMessage = (parentProjectFolder: FileUri) =>
    `Opened folder does not contain a valid Lean 4 project folder because it does not contain a 'lean-toolchain' file.
However, a valid Lean 4 project folder was found in one of the parent directories at '${parentProjectFolder.fsPath}'.
Open this project instead?`

const lean3ProjectErrorMessage = (projectVersion: SemVer) =>
    `Opened file is using Lean 3 (version: ${projectVersion.toString()}).
If you want to use Lean 3, disable this extension ('Extensions' in the left sidebar > Cog icon on 'lean4' > 'Disable') and install the 'lean' extension for Lean 3 support.`

const ancientLean4ProjectWarningMessage = (projectVersion: SemVer) =>
    `Opened file is using a Lean 4 version (${projectVersion.toString()}) from before the first Lean 4 stable release (4.0.0).
Pre-stable Lean 4 versions are increasingly less supported, so please consider updating to a newer Lean 4 version.`

class ProjectDiagnosticsProvider {
    readonly channel: OutputChannel
    readonly folderUri: ExtUri

    constructor(channel: OutputChannel, folderUri: ExtUri) {
        this.channel = channel
        this.folderUri = folderUri
    }

    private diagnose(): SetupDiagnoser {
        const cwd = this.folderUri.scheme === 'file' ? this.folderUri : undefined
        return diagnose(this.channel, cwd)
    }

    async checkIsValidProjectFolder(): Promise<Boolean> {
        const projectSetupDiagnosis = await this.diagnose().projectSetup()
        switch (projectSetupDiagnosis.kind) {
            case 'SingleFile':
                displaySetupWarning(singleFileWarningMessage)
                return false

            case 'MissingLeanToolchain':
                const parentProjectFolder = projectSetupDiagnosis.parentProjectFolder
                if (parentProjectFolder === undefined) {
                    displaySetupWarning(missingLeanToolchainWarningMessage)
                } else {
                    displaySetupWarningWithOptionalInput(
                        missingLeanToolchainWithParentProjectWarningMessage(parentProjectFolder),
                        'Open Parent Directory Project',
                        // this kills the extension host
                        () => commands.executeCommand('vscode.openFolder', parentProjectFolder),
                    )
                }
                return false

            case 'ValidProjectSetup':
                return true
        }
    }

    async checkIsLeanVersionUpToDate(): Promise<PreconditionCheckResult> {
        const projectLeanVersionDiagnosis = await this.diagnose().projectLeanVersion()
        switch (projectLeanVersionDiagnosis.kind) {
            case 'NotInstalled':
                displaySetupErrorWithOutput("Error while checking Lean version: 'lean' command was not found.")
                return PreconditionCheckResult.Fatal

            case 'ExecutionError':
                displaySetupErrorWithOutput(`Error while checking Lean version: ${projectLeanVersionDiagnosis.message}`)
                return PreconditionCheckResult.Fatal

            case 'IsLean3Version':
                void displaySetupError(lean3ProjectErrorMessage(projectLeanVersionDiagnosis.version))
                return PreconditionCheckResult.Fatal

            case 'IsAncientLean4Version':
                displaySetupWarning(ancientLean4ProjectWarningMessage(projectLeanVersionDiagnosis.version))
                return PreconditionCheckResult.Warning

            case 'UpToDate':
                return PreconditionCheckResult.Fulfilled
        }
    }

    async checkIsLakeInstalled(): Promise<PreconditionCheckResult> {
        const lakeVersionResult = await this.diagnose().queryLakeVersion()
        switch (lakeVersionResult.kind) {
            case 'CommandNotFound':
                displaySetupErrorWithOutput("Error while checking Lake version: 'lake' command was not found.")
                return PreconditionCheckResult.Fatal

            case 'CommandError':
                displaySetupErrorWithOutput(`Error while checking Lake version: ${lakeVersionResult.message}`)
                return PreconditionCheckResult.Fatal

            case 'InvalidVersion':
                displaySetupErrorWithOutput(
                    `Error while checking Lake version: Invalid Lake version format: '${lakeVersionResult.versionResult}'`,
                )
                return PreconditionCheckResult.Fatal

            case 'Success':
                return PreconditionCheckResult.Fulfilled
        }
    }
}

export async function checkLean4ProjectPreconditions(
    channel: OutputChannel,
    folderUri: ExtUri,
): Promise<PreconditionCheckResult> {
    const diagnosticsProvider = new ProjectDiagnosticsProvider(channel, folderUri)

    const isValidProjectFolder = await diagnosticsProvider.checkIsValidProjectFolder()
    const validProjectFolderCheckResult = isValidProjectFolder
        ? PreconditionCheckResult.Fulfilled
        : PreconditionCheckResult.Warning

    const leanVersionCheckResult = await diagnosticsProvider.checkIsLeanVersionUpToDate()

    const leanProjectCheckResult = worstPreconditionViolation(validProjectFolderCheckResult, leanVersionCheckResult)
    if (leanProjectCheckResult === PreconditionCheckResult.Fatal) {
        return PreconditionCheckResult.Fatal
    }

    const lakeVersionCheckResult = await diagnosticsProvider.checkIsLakeInstalled()

    return worstPreconditionViolation(leanProjectCheckResult, lakeVersionCheckResult)
}
