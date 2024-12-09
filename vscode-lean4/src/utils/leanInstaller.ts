import { SemVer } from 'semver'
import { Disposable, EventEmitter, OutputChannel, TerminalOptions, window } from 'vscode'
import { getPowerShellPath, isRunningTest, setAlwaysAskBeforeInstallingLeanVersions } from '../config'
import { ExecutionExitCode, displayResultError } from './batch'
import { elanSelfUninstall, elanSelfUpdate, elanVersion, isElanEagerToolchainResolutionVersion } from './elan'
import { FileUri } from './exturi'
import { logger } from './logger'
import {
    NotificationSeverity,
    StickyInput,
    StickyNotificationOptions,
    displayNotification,
    displayNotificationWithInput,
    displayNotificationWithOptionalInput,
    displayStickyNotificationWithOptionalInput,
} from './notifs'

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
    private leanInstallerLinux = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh'
    private leanInstallerWindows = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1'
    private outputChannel: OutputChannel
    private prompting: boolean = false
    private installing: boolean = false
    private freshInstallDefaultToolchain: string
    private promptUser: boolean = true

    // This event is raised whenever a version change happens.
    // The event provides the workspace Uri where the change happened.
    private installChangedEmitter = new EventEmitter<FileUri>()
    installChanged = this.installChangedEmitter.event

    constructor(outputChannel: OutputChannel, freshInstallDefaultToolchain: string) {
        this.outputChannel = outputChannel
        this.freshInstallDefaultToolchain = freshInstallDefaultToolchain
        if (isRunningTest()) {
            this.promptUser = false
            if (process.env.LEAN4_PROMPT_USER === 'true') {
                this.promptUser = true
            }
        }
    }

    getPromptUser(): boolean {
        return this.promptUser
    }

    getOutputChannel(): OutputChannel {
        return this.outputChannel
    }

    handleVersionChanged(packageUri: FileUri) {
        void this.showRestartPromptAndRestart('Lean version changed', packageUri)
    }

    isPromptVisible() {
        return this.prompting
    }

    private async showRestartPromptAndRestart(message: string, packageUri: FileUri) {
        if (!this.promptUser) {
            this.installChangedEmitter.fire(packageUri)
            return
        }

        if (this.prompting) {
            return
        }

        this.prompting = true
        const finalizer = () => {
            this.prompting = false
        }
        displayNotificationWithOptionalInput(
            'Error',
            message,
            [{ input: 'Restart Lean', action: () => this.installChangedEmitter.fire(packageUri) }],
            finalizer,
        )
    }

    handleLakeFileChanged(packageUri: FileUri) {
        void this.showRestartPromptAndRestart('Lake file configuration changed', packageUri)
    }

    private installElanPrompt(reason: string | undefined): { message: string; item: 'Install Elan and Lean 4' } {
        const reasonPrefix = reason ? reason + ' ' : ''
        const message =
            reasonPrefix + "Do you want to install Lean's version manager Elan and a recent stable version of Lean 4?"
        const item = 'Install Elan and Lean 4'
        return { message, item }
    }

    async displayInstallElanPromptWithItems(
        severity: NotificationSeverity,
        reason: string | undefined,
        otherItems: string[] = [],
        defaultItem?: string | undefined,
    ): Promise<{ kind: 'InstallElan'; success: boolean } | { kind: 'OtherItem'; choice: string } | undefined> {
        if (!this.getPromptUser()) {
            // Used in tests
            await this.autoInstall()
            return { kind: 'InstallElan', success: true }
        }

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
        options: StickyNotificationOptions<'Install Elan and Lean 4' | string>,
        otherItems: StickyInput<string>[] = [],
    ): Disposable {
        const p = this.installElanPrompt(reason)
        const installElanItem: StickyInput<'Install Elan and Lean 4'> = {
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
                    message: 'Do you want to update Elan?',
                    item: 'Update Elan',
                }
            case 'Outdated':
                return {
                    message: `Lean's version manager Elan is outdated: the installed version is ${mode.versions.currentVersion.toString()}, but a version of ${mode.versions.recommendedVersion.toString()} is recommended. Do you want to update Elan?`,
                    item: 'Update Elan',
                }
        }
    }

    private async displayElanUpdateSuccessfulPrompt(currentVersion: SemVer) {
        if (!isElanEagerToolchainResolutionVersion(currentVersion)) {
            displayNotification('Information', 'Elan update successful!')
            return
        }

        const prompt =
            'Elan update successful!' +
            '\n\n' +
            'Do you want Elan in VS Code to download and install Lean versions automatically, or would you prefer it to ask for confirmation before downloading and installing new Lean versions?' +
            '\n' +
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

    private async autoInstall(): Promise<void> {
        logger.log('[LeanInstaller] Installing Elan ...')
        await this.installElan()
        logger.log('[LeanInstaller] Elan installed')
    }

    private async installElanAndDisplaySettingPrompt(): Promise<
        'Success' | 'InstallationFailed' | 'PendingInstallation'
    > {
        const r = await this.installElan()

        const prompt =
            'Elan installation successful!' +
            '\n\n' +
            'Do you want Elan in VS Code to download and install Lean versions automatically, or would you prefer it to ask for confirmation before downloading and installing new Lean versions?' +
            '\n' +
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

    private async installElan(): Promise<'Success' | 'InstallationFailed' | 'PendingInstallation'> {
        if (this.installing) {
            displayNotification(
                'Error',
                'Elan is already being installed. Please wait until the installation has finished.',
            )
            return 'PendingInstallation'
        }
        this.installing = true
        try {
            const terminalName = 'Lean installation via elan'

            let terminalOptions: TerminalOptions = { name: terminalName }
            if (process.platform === 'win32') {
                terminalOptions = { name: terminalName, shellPath: getPowerShellPath() }
            }
            const terminal = window.createTerminal(terminalOptions)
            terminal.show()

            // We register a listener, to restart the Lean extension once elan has finished.
            const resultPromise = new Promise<boolean>(function (resolve, reject) {
                window.onDidCloseTerminal(async t => {
                    if (t === terminal) {
                        resolve(true)
                    } else {
                        logger.log(
                            '[LeanInstaller] ignoring terminal closed: ' + t.name + ', waiting for: ' + terminalName,
                        )
                    }
                })
            })

            if (process.platform === 'win32') {
                terminal.sendText(
                    `Start-BitsTransfer -Source "${this.leanInstallerWindows}" -Destination "elan-init.ps1"\r\n` +
                        'Set-ExecutionPolicy -ExecutionPolicy Unrestricted -Scope Process\r\n' +
                        `$rc = .\\elan-init.ps1 -NoPrompt 1 -DefaultToolchain ${this.freshInstallDefaultToolchain}\r\n` +
                        'Write-Host "elan-init returned [$rc]"\r\n' +
                        'del .\\elan-init.ps1\r\n' +
                        'if ($rc -ne 0) {\r\n' +
                        '    Read-Host -Prompt "Press ENTER to continue"\r\n' +
                        '}\r\n' +
                        'exit\r\n',
                )
            } else {
                const elanArgs = `-y --default-toolchain ${this.freshInstallDefaultToolchain}`
                const prompt = '(echo && read -n 1 -s -r -p "Install failed, press ENTER to continue...")'

                terminal.sendText(
                    `bash -c 'curl ${this.leanInstallerLinux} -sSf | sh -s -- ${elanArgs} || ${prompt}' && exit `,
                )
            }

            const result = await resultPromise
            if (!result) {
                displayNotification('Error', 'Elan installation failed. Check the terminal output for details.')
                return 'InstallationFailed'
            }
            return 'Success'
        } finally {
            this.installing = false
        }
    }

    async uninstallElan() {
        const prompt =
            "This command will uninstall Lean's version manager Elan and all installed Lean version.\n" +
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
    }
}
