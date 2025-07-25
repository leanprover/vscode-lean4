import { SemVer } from 'semver'
import { Disposable, OutputChannel } from 'vscode'
import { setAlwaysAskBeforeInstallingLeanVersions } from '../config'
import { ExecutionExitCode, ExecutionResult, batchExecuteWithProgress, displayResultError } from './batch'
import { elanSelfUninstall, elanSelfUpdate, elanVersion, isElanEagerResolutionVersion } from './elan'
import {
    NotificationSeverity,
    StickyInput,
    StickyNotificationOptions,
    displayNotification,
    displayNotificationWithInput,
    displayStickyNotificationWithOptionalInput,
} from './notifs'

const windowsInstallationScript = (freshInstallDefaultToolchain: string) =>
    `Invoke-WebRequest -Uri "https://elan.lean-lang.org/elan-init.ps1" -OutFile "elan-init.ps1"
Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process
$rc = .\\elan-init.ps1 -NoPrompt 1 -DefaultToolchain ${freshInstallDefaultToolchain}
del .\\elan-init.ps1
exit $rc`

const unixInstallationScript = (freshInstallDefaultToolchain: string) =>
    `curl "https://elan.lean-lang.org/elan-init.sh" -sSf | sh -s -- -y --default-toolchain ${freshInstallDefaultToolchain}`

export class LeanVersion {
    version: string
    error: string | undefined
}

export type UpdateElanMode =
    | {
          kind: 'Outdated'
          versions: { currentVersion: SemVer; recommendedVersion: SemVer }
      }
    | {
          kind: 'Manual'
          versions: { currentVersion: SemVer }
      }

export class LeanInstaller {
    private outputChannel: OutputChannel
    private pendingOperation: 'Install' | 'Update' | 'Uninstall' | undefined
    private freshInstallDefaultToolchain: string

    constructor(outputChannel: OutputChannel, freshInstallDefaultToolchain: string) {
        this.outputChannel = outputChannel
        this.freshInstallDefaultToolchain = freshInstallDefaultToolchain
    }

    getOutputChannel(): OutputChannel {
        return this.outputChannel
    }

    private installElanPrompt(reason: string | undefined): { message: string; item: 'Install Elan' } {
        let message: string
        if (reason !== undefined) {
            message = `${reason} Do you wish to install Lean's version manager Elan?`
        } else {
            message = "This command will install Lean's version manager Elan.\n\n" + 'Do you wish to proceed?'
        }
        const item = 'Install Elan'
        return { message, item }
    }

    async displayInstallElanPromptWithItems(
        severity: NotificationSeverity,
        reason: string | undefined,
        otherItems: string[] = [],
        defaultItem?: string | undefined,
    ): Promise<{ kind: 'InstallElan'; success: boolean } | { kind: 'OtherItem'; choice: string } | undefined> {
        const p = this.installElanPrompt(reason)
        const choice = await displayNotificationWithInput(severity, p.message, [p.item, ...otherItems], defaultItem)
        if (choice === undefined) {
            return undefined
        }
        if (choice === p.item) {
            return { kind: 'InstallElan', success: (await this.installElanAndDisplaySettingPrompt()) === 'Success' }
        }
        return { kind: 'OtherItem', choice }
    }

    async displayInstallElanPrompt(severity: NotificationSeverity, reason: string | undefined): Promise<boolean> {
        const r = await this.displayInstallElanPromptWithItems(severity, reason)
        if (r !== undefined && r.kind === 'InstallElan') {
            return r.success
        }
        return false
    }

    displayStickyInstallElanPrompt(
        severity: NotificationSeverity,
        reason: string | undefined,
        // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
        options: StickyNotificationOptions<'Install Elan' | string>,
        otherItems: StickyInput<string>[] = [],
    ): Disposable {
        const p = this.installElanPrompt(reason)
        const installElanItem: StickyInput<'Install Elan'> = {
            input: p.item,
            continueDisplaying: false,
            action: async () => {
                await this.installElanAndDisplaySettingPrompt()
            },
        }
        return displayStickyNotificationWithOptionalInput(severity, p.message, options, [
            installElanItem,
            ...otherItems,
        ])
    }

    private updateElanPrompt(mode: UpdateElanMode): { message: string; item: 'Update Elan' } {
        switch (mode.kind) {
            case 'Manual':
                return {
                    message:
                        "This command will update Lean's version manager Elan to its most recent version.\n\n" +
                        'Do you wish to proceed?',
                    item: 'Update Elan',
                }
            case 'Outdated':
                return {
                    message:
                        `Lean's version manager Elan is outdated: the installed version is ${mode.versions.currentVersion.toString()}, but a version of ${mode.versions.recommendedVersion.toString()} is recommended.\n\n` +
                        'Do you wish to update Elan?',
                    item: 'Update Elan',
                }
        }
    }

    private async displayElanUpdateSuccessfulPrompt(currentVersion: SemVer) {
        if (isElanEagerResolutionVersion(currentVersion)) {
            displayNotification('Information', 'Elan update successful!')
            return
        }

        const prompt =
            'Elan update successful!\n\n' +
            'Do you want Elan in VS Code to continue downloading and installing Lean versions automatically, or would you prefer it to ask for confirmation before downloading and installing new Lean versions?\n' +
            'Asking for confirmation is especially desirable if you are ever using a limited internet data plan or your internet connection tends to be slow, whereas automatic installs are less tedious on fast and unlimited internet connections.'

        const choice = await displayNotificationWithInput(
            'Information',
            prompt,
            ['Always Ask For Confirmation'],
            'Install Lean Versions Automatically',
        )
        if (choice === 'Always Ask For Confirmation') {
            await setAlwaysAskBeforeInstallingLeanVersions(true)
        }
        if (choice === 'Install Lean Versions Automatically') {
            await setAlwaysAskBeforeInstallingLeanVersions(false)
        }
    }

    private async updateElan(currentVersion: SemVer): Promise<boolean> {
        const r = await this.performOperation('Update', async () => {
            if (currentVersion.compare('3.1.0') === 0) {
                // `elan self update` was broken in elan 3.1.0, so we need to take a different approach to updating elan here.
                const installElanResult = await this.installElanAndDisplaySettingPrompt()
                if (installElanResult !== 'Success') {
                    return false
                }
                await this.displayElanUpdateSuccessfulPrompt(currentVersion)
                return true
            }

            const elanSelfUpdateResult = await elanSelfUpdate(this.outputChannel, 'Update Elan')
            if (elanSelfUpdateResult.exitCode !== ExecutionExitCode.Success) {
                displayResultError(
                    elanSelfUpdateResult,
                    "Cannot update Elan. If you suspect that this is due to the way that you have set up Elan (e.g. from a package repository that ships an outdated version of Elan), you can disable these warnings using the 'Lean4: Show Setup Warnings' setting under 'File' > 'Preferences' > 'Settings'.",
                )
                return false
            }

            await this.displayElanUpdateSuccessfulPrompt(currentVersion)

            return true
        })
        if (r === 'PendingOperation') {
            return false
        }
        return r
    }

    async displayUpdateElanPromptWithItems(
        severity: NotificationSeverity,
        mode: UpdateElanMode,
        otherItems: string[] = [],
        defaultItem?: string | undefined,
    ): Promise<{ kind: 'UpdateElan'; success: boolean } | { kind: 'OtherItem'; choice: string } | undefined> {
        const p = this.updateElanPrompt(mode)
        const choice = await displayNotificationWithInput(severity, p.message, [p.item, ...otherItems], defaultItem)
        if (choice === undefined) {
            return undefined
        }
        if (choice === p.item) {
            return { kind: 'UpdateElan', success: await this.updateElan(mode.versions.currentVersion) }
        }
        return { kind: 'OtherItem', choice }
    }

    async displayUpdateElanPrompt(severity: NotificationSeverity, mode: UpdateElanMode): Promise<boolean> {
        const r = await this.displayUpdateElanPromptWithItems(severity, mode)
        if (r !== undefined && r.kind === 'UpdateElan') {
            return r.success
        }
        return false
    }

    displayStickyUpdateElanPrompt(
        severity: NotificationSeverity,
        mode: UpdateElanMode,
        // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
        options: StickyNotificationOptions<'Update Elan' | string>,
        otherItems: StickyInput<string>[] = [],
    ): Disposable {
        const p = this.updateElanPrompt(mode)
        const updateElanItem: StickyInput<'Update Elan'> = {
            input: p.item,
            continueDisplaying: false,
            action: async () => {
                await this.updateElan(mode.versions.currentVersion)
            },
        }
        return displayStickyNotificationWithOptionalInput(severity, p.message, options, [updateElanItem, ...otherItems])
    }

    async displayManualUpdateElanPrompt() {
        const versionResult = await elanVersion()
        switch (versionResult.kind) {
            case 'Success':
                await this.displayUpdateElanPrompt('Information', {
                    kind: 'Manual',
                    versions: { currentVersion: versionResult.version },
                })
                break
            case 'ElanNotInstalled':
                displayNotification('Error', 'Elan is not installed.')
                break
            case 'ExecutionError':
                displayNotification('Error', `Error while determining current Elan version: ${versionResult.message}`)
                break
        }
    }

    private async installElanAndDisplaySettingPrompt(): Promise<'Success' | 'InstallationFailed' | 'PendingOperation'> {
        const r = await this.installElan()

        if (r !== 'Success') {
            return r
        }

        const prompt =
            'Elan installation successful!\n\n' +
            'Do you want Elan in VS Code to download and install Lean versions automatically, or would you prefer it to ask for confirmation before downloading and installing new Lean versions?\n' +
            'Asking for confirmation is especially desirable if you are ever using a limited internet data plan or your internet connection tends to be slow, whereas automatic installs are less tedious on fast and unlimited internet connections.'

        const choice = await displayNotificationWithInput(
            'Information',
            prompt,
            ['Always Ask For Confirmation'],
            'Install Lean Versions Automatically',
        )
        if (choice === 'Always Ask For Confirmation') {
            await setAlwaysAskBeforeInstallingLeanVersions(true)
        }
        if (choice === 'Install Lean Versions Automatically') {
            await setAlwaysAskBeforeInstallingLeanVersions(false)
        }

        return r
    }

    private async installElan(): Promise<'Success' | 'InstallationFailed' | 'PendingOperation'> {
        return await this.performOperation('Install', async () => {
            let result: ExecutionResult
            if (process.platform === 'win32') {
                result = await batchExecuteWithProgress(
                    windowsInstallationScript(this.freshInstallDefaultToolchain),
                    [],
                    'Lean Installation',
                    "Installing Lean's version manager Elan",
                    {
                        channel: this.outputChannel,
                        allowCancellation: true,
                        shell: 'Windows',
                    },
                )
            } else {
                result = await batchExecuteWithProgress(
                    unixInstallationScript(this.freshInstallDefaultToolchain),
                    [],
                    'Lean Installation',
                    "Installing Lean's version manager Elan",
                    {
                        channel: this.outputChannel,
                        allowCancellation: true,
                        shell: 'Unix',
                    },
                )
            }

            switch (result.exitCode) {
                case ExecutionExitCode.Success:
                    displayNotification('Information', 'Installation successful!')
                    return 'Success'
                case ExecutionExitCode.CannotLaunch:
                    displayNotification('Error', 'Installation failed: installation script could not be launched.')
                    return 'InstallationFailed'
                case ExecutionExitCode.ExecutionError:
                    displayResultError(result, 'Installation failed.')
                    return 'InstallationFailed'
                case ExecutionExitCode.Cancelled:
                    return 'InstallationFailed'
            }
        })
    }

    async uninstallElan() {
        await this.performOperation('Uninstall', async () => {
            const prompt =
                "This command will uninstall Lean's version manager Elan and all installed Lean versions.\n\n" +
                'Do you wish to proceed?'
            const choice = await displayNotificationWithInput('Information', prompt, ['Proceed'])
            if (choice !== 'Proceed') {
                return
            }

            const r = await elanSelfUninstall(this.outputChannel, 'Uninstall Elan')
            switch (r.exitCode) {
                case ExecutionExitCode.Success:
                    displayNotification('Information', 'Elan uninstalled successfully.')
                    break
                case ExecutionExitCode.CannotLaunch:
                    displayNotification('Error', 'Elan is not installed.')
                    break
                case ExecutionExitCode.ExecutionError:
                    displayNotification('Error', `Error while installing Elan: ${r.combined}`)
                    break
                case ExecutionExitCode.Cancelled:
                    displayNotification('Information', 'Uninstalling Elan cancelled.')
            }
        })
    }

    private async performOperation<T>(
        kind: 'Install' | 'Update' | 'Uninstall',
        op: () => Promise<T>,
    ): Promise<T | 'PendingOperation'> {
        switch (this.pendingOperation) {
            case 'Install':
                displayNotification(
                    'Error',
                    'Elan is being installed. Please wait until the installation has finished.',
                )
                return 'PendingOperation'
            case 'Update':
                displayNotification('Error', 'Elan is being updated. Please wait until the update has finished.')
                return 'PendingOperation'
            case 'Uninstall':
                displayNotification(
                    'Error',
                    'Elan is being uninstalled. Please wait until the deinstallation has finished.',
                )
                return 'PendingOperation'
            case undefined:
                this.pendingOperation = kind
                try {
                    return await op()
                } finally {
                    this.pendingOperation = undefined
                }
        }
    }
}
