import { SemVer } from 'semver'
import { OutputChannel } from 'vscode'
import { checkLean4FeaturePreconditions } from './globalDiagnostics'
import { FileUri } from './utils/exturi'
import { LeanInstaller } from './utils/leanInstaller'
import {
    PreconditionCheckResult,
    SetupDiagnoser,
    diagnose,
    displaySetupError,
    displaySetupErrorWithOutput,
    displaySetupWarning,
    worstPreconditionViolation,
} from './utils/setupDiagnostics'

const lean3ToolchainErrorMessage = (toolchainVersion: SemVer) =>
    `The current toolchain is a Lean 3 toolchain (version: ${toolchainVersion.toString()}).
If you want to use Lean 3, disable this extension ('Extensions' in the left sidebar > Cog icon on 'lean4' > 'Disable') and install the 'lean' extension for Lean 3 support.`

const ancientLean4ToolchainWarningMessage = (toolchainVersion: SemVer) =>
    `The current toolchain is using a Lean 4 version (${toolchainVersion.toString()}) from before the first Lean 4 stable release (4.0.0).
Pre-stable Lean 4 versions are increasingly less supported, so please consider updating to a newer Lean 4 version.`

class ProjectInitDiagnosticsProvider {
    readonly channel: OutputChannel
    readonly folderUri: FileUri

    constructor(channel: OutputChannel, folderUri: FileUri) {
        this.channel = channel
        this.folderUri = folderUri
    }

    private diagnose(): SetupDiagnoser {
        const cwd = this.folderUri.scheme === 'file' ? this.folderUri : undefined
        return diagnose(this.channel, cwd)
    }

    async checkIsLeanVersionUpToDate(): Promise<PreconditionCheckResult> {
        const projectLeanVersionDiagnosis = await this.diagnose().leanVersion()
        switch (projectLeanVersionDiagnosis.kind) {
            case 'NotInstalled':
                displaySetupErrorWithOutput("Error while checking Lean version: 'lean' command was not found.")
                return PreconditionCheckResult.Fatal

            case 'ExecutionError':
                displaySetupErrorWithOutput(`Error while checking Lean version: ${projectLeanVersionDiagnosis.message}`)
                return PreconditionCheckResult.Fatal

            case 'IsLean3Version':
                displaySetupError(lean3ToolchainErrorMessage(projectLeanVersionDiagnosis.version))
                return PreconditionCheckResult.Fatal

            case 'IsAncientLean4Version':
                displaySetupWarning(ancientLean4ToolchainWarningMessage(projectLeanVersionDiagnosis.version))
                return PreconditionCheckResult.Warning

            case 'UpToDate':
                return PreconditionCheckResult.Fulfilled
        }
    }

    async checkIsLakeInstalledCorrectly(): Promise<PreconditionCheckResult> {
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

export async function checkLean4ProjectInitPreconditions(
    installer: LeanInstaller,
    folderUri: FileUri,
): Promise<PreconditionCheckResult> {
    const lean4FeaturePreconditionCheckResult = await checkLean4FeaturePreconditions(installer, folderUri)
    if (lean4FeaturePreconditionCheckResult === PreconditionCheckResult.Fatal) {
        return PreconditionCheckResult.Fatal
    }

    const diagnosticsProvider = new ProjectInitDiagnosticsProvider(installer.getOutputChannel(), folderUri)

    const leanVersionCheckResult = await diagnosticsProvider.checkIsLeanVersionUpToDate()
    if (leanVersionCheckResult === PreconditionCheckResult.Fatal) {
        return PreconditionCheckResult.Fatal
    }

    const lakeVersionCheckResult = await diagnosticsProvider.checkIsLakeInstalledCorrectly()
    return worstPreconditionViolation(
        lean4FeaturePreconditionCheckResult,
        leanVersionCheckResult,
        lakeVersionCheckResult,
    )
}
