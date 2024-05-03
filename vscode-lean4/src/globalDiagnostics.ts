import { OutputChannel, commands } from 'vscode'
import { elanSelfUpdate } from './utils/elan'
import { FileUri } from './utils/exturi'
import { LeanInstaller } from './utils/leanInstaller'
import {
    PreconditionCheckResult,
    SetupDiagnoser,
    diagnose,
    showSetupError,
    showSetupErrorWithOutput,
    showSetupWarning,
    showSetupWarningWithOutput,
} from './utils/setupDiagnostics'

class GlobalDiagnosticsProvider {
    readonly installer: LeanInstaller
    readonly channel: OutputChannel
    readonly cwdUri: FileUri | undefined

    constructor(installer: LeanInstaller, cwdUri: FileUri | undefined) {
        this.installer = installer
        this.channel = installer.getOutputChannel()
        this.cwdUri = cwdUri
    }

    private diagnose(): SetupDiagnoser {
        return diagnose(this.channel, this.cwdUri)
    }

    async checkDependenciesAreInstalled(): Promise<boolean> {
        const isCurlInstalled = await this.diagnose().checkCurlAvailable()
        const isGitInstalled = await this.diagnose().checkGitAvailable()
        if (isCurlInstalled && isGitInstalled) {
            return true
        }

        let missingDepMessage: string
        if (!isCurlInstalled && isGitInstalled) {
            missingDepMessage = "One of Lean's dependencies ('curl') is missing"
        } else if (isCurlInstalled && !isGitInstalled) {
            missingDepMessage = "One of Lean's dependencies ('git') is missing"
        } else {
            missingDepMessage = "Both of Lean's dependencies ('curl' and 'git') are missing"
        }

        const errorMessage = `${missingDepMessage}. Please read the Setup Guide on how to install missing dependencies and set up Lean 4.`
        const openSetupGuideInput = 'Open Setup Guide'
        const choice = await showSetupError(errorMessage, openSetupGuideInput)
        if (choice === openSetupGuideInput) {
            await commands.executeCommand('lean4.setup.showSetupGuide')
        }
        return false
    }

    async checkLean4IsInstalled(): Promise<boolean> {
        const leanVersionResult = await this.diagnose().queryLeanVersion()
        switch (leanVersionResult.kind) {
            case 'Success':
                return true

            case 'CommandError':
                void showSetupErrorWithOutput(`Error while checking Lean version: ${leanVersionResult.message}`)
                return false

            case 'InvalidVersion':
                void showSetupErrorWithOutput(
                    `Error while checking Lean version: 'lean --version' returned a version that could not be parsed: '${leanVersionResult.versionResult}'`,
                )
                return false

            case 'CommandNotFound':
                if (!this.installer.getPromptUser()) {
                    // Used in tests
                    await this.installer.autoInstall()
                    return true
                }

                const installElanItem = 'Install Elan and Lean 4'
                const installElanChoice = await showSetupError(
                    "Lean is not installed. Do you want to install Lean's version manager Elan and a recent stable version of Lean 4?",
                    installElanItem,
                )
                if (installElanChoice === undefined) {
                    return false
                }
                await this.installer.installElan()
                return true
        }
    }

    async checkElanIsUpToDate(): Promise<boolean> {
        const elanDiagnosis = await this.diagnose().elan()

        switch (elanDiagnosis.kind) {
            case 'NotInstalled':
                const installElanItem = 'Install Elan and Lean 4'
                const installElanChoice = await showSetupWarning(
                    "Lean's version manager Elan is not installed. This means that the correct Lean 4 toolchain version of Lean 4 projects will not be selected or installed automatically. Do you want to install Elan and a recent stable version of Lean 4?",
                    installElanItem,
                )
                if (installElanChoice === undefined) {
                    return false
                }
                await this.installer.installElan()
                return true

            case 'ExecutionError':
                void showSetupWarningWithOutput('Cannot determine Elan version: ' + elanDiagnosis.message)
                return false

            case 'Outdated':
                const updateElanItem = 'Update Elan'
                const updateElanChoice = await showSetupWarning(
                    `Lean's version manager Elan is outdated: the installed version is ${elanDiagnosis.currentVersion.toString()}, but a version of ${elanDiagnosis.recommendedVersion.toString()} is recommended. Do you want to update Elan?`,
                    updateElanItem,
                )
                if (updateElanChoice === undefined) {
                    return false
                }
                await elanSelfUpdate(this.channel)
                return true

            case 'UpToDate':
                return true
        }
    }
}

export async function checkLean4FeaturePreconditions(
    installer: LeanInstaller,
    cwdUri: FileUri | undefined,
): Promise<PreconditionCheckResult> {
    const diagnosticsProvider = new GlobalDiagnosticsProvider(installer, cwdUri)

    const areDependenciesInstalled = await diagnosticsProvider.checkDependenciesAreInstalled()
    if (!areDependenciesInstalled) {
        return PreconditionCheckResult.Fatal
    }

    const isLean4Installed = await diagnosticsProvider.checkLean4IsInstalled()
    if (!isLean4Installed) {
        return PreconditionCheckResult.Fatal
    }

    const isElanUpToDate = await diagnosticsProvider.checkElanIsUpToDate()
    if (!isElanUpToDate) {
        return PreconditionCheckResult.Warning
    }

    return PreconditionCheckResult.Fulfilled
}
