import { SemVer } from 'semver'
import { OutputChannel, commands, window } from 'vscode'
import { displayErrorWithOutput } from './utils/errors'
import { ExtUri, FileUri } from './utils/exturi'
import { PreconditionCheckResult, SetupDiagnoser, diagnose, worstPreconditionViolation } from './utils/setupDiagnostics'

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
    `Opened project uses a Lean 4 version (${projectVersion.toString()}) from before the first Lean 4 stable release (4.0.0).
Pre-stable Lean 4 versions are increasingly less supported, so please consider updating this project to a newer Lean 4 version.`

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
                void window.showWarningMessage(singleFileWarningMessage)
                return false

            case 'MissingLeanToolchain':
                const parentProjectFolder = projectSetupDiagnosis.parentProjectFolder
                if (parentProjectFolder === undefined) {
                    void window.showWarningMessage(missingLeanToolchainWarningMessage)
                } else {
                    const input = 'Open parent directory project'
                    const choice: string | undefined = await window.showWarningMessage(
                        missingLeanToolchainWithParentProjectWarningMessage(parentProjectFolder),
                        input,
                    )
                    if (choice === input) {
                        // this kills the extension host
                        await commands.executeCommand('vscode.openFolder', parentProjectFolder)
                    }
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
                void displayErrorWithOutput("Error while checking Lean version: 'lean' command was not found.")
                return PreconditionCheckResult.Fatal

            case 'ExecutionError':
                void displayErrorWithOutput(`Error while checking Lean version: ${projectLeanVersionDiagnosis.message}`)
                return PreconditionCheckResult.Fatal

            case 'IsLean3Version':
                void window.showErrorMessage(lean3ProjectErrorMessage(projectLeanVersionDiagnosis.version))
                return PreconditionCheckResult.Fatal

            case 'IsAncientLean4Version':
                void window.showWarningMessage(ancientLean4ProjectWarningMessage(projectLeanVersionDiagnosis.version))
                return PreconditionCheckResult.Warning

            case 'UpToDate':
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

    return worstPreconditionViolation(validProjectFolderCheckResult, leanVersionCheckResult)
}
