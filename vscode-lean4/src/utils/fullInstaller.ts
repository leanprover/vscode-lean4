import { commands, Disposable, env, OutputChannel } from 'vscode'
import { displayModalResultError } from './batch'
import {
    DependencyInstallationMethod,
    DependencyInstallationProcedure,
    DepInstaller,
    MissingDependencyInstallationProcedure,
    missingDepsSentence,
    unsuccessfulDependencyInstallationPrompt,
} from './depInstaller'
import { LeanInstaller } from './leanInstaller'
import { displayModalNotification, displayNotificationWithInput } from './notifs'

export class FullInstaller implements Disposable {
    private subscriptions: Disposable[] = []

    constructor(
        readonly outputChannel: OutputChannel,
        readonly depInstaller: DepInstaller,
        readonly leanInstaller: LeanInstaller,
    ) {
        this.subscriptions.push(
            commands.registerCommand('lean4.setup.installLean', () => this.displayInstallLeanPrompt()),
        )
    }

    async displayInstallLeanPrompt(): Promise<'Success' | 'PendingInstall' | 'Failure'> {
        const dependencyInstallationProcedure = await this.depInstaller.determineDependencyInstallationProcedure()
        if (
            dependencyInstallationProcedure.kind !== 'AllDepsInstalled' &&
            dependencyInstallationProcedure.method.kind === 'Manual'
        ) {
            await this.displayManualInstallationPrompt(dependencyInstallationProcedure)
            return 'Failure'
        }

        const choice = await displayNotificationWithInput(
            'Information',
            this.installationPrompt(dependencyInstallationProcedure),
            ['Proceed'],
        )
        if (choice !== 'Proceed') {
            return 'Failure'
        }
        if (dependencyInstallationProcedure.kind !== 'AllDepsInstalled') {
            const dependencyInstallationResult = await this.depInstaller.installMissingDeps(
                dependencyInstallationProcedure,
            )
            if (dependencyInstallationResult.kind === 'Error') {
                await displayModalResultError(
                    dependencyInstallationResult.result,
                    unsuccessfulDependencyInstallationPrompt(dependencyInstallationProcedure),
                )
                return 'Failure'
            }
            if (dependencyInstallationResult.kind === 'Cancelled') {
                return 'Failure'
            }
            if (dependencyInstallationResult.kind === 'PendingInstall') {
                return 'PendingInstall'
            }
            dependencyInstallationResult.kind satisfies 'Success'
        }
        const elanInstallationResult = await this.leanInstaller.installElan()
        switch (elanInstallationResult.kind) {
            case 'Success':
                await this.leanInstaller.displayInstallationSuccessfulPrompt()
                return 'Success'
            case 'Error':
                await this.leanInstaller.displayInstallationUnsuccessfulPrompt(elanInstallationResult.result)
                return 'Failure'
            case 'Cancelled':
                return 'Failure'
            case 'PendingOperation':
                return 'PendingInstall'
        }
    }

    private installationPrompt(p: DependencyInstallationProcedure): string {
        let specifics: string
        if (p.kind === 'AllDepsInstalled' || (p.isCurlAvailable && p.isGitAvailable)) {
            specifics =
                "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system."
        } else if (p.isCurlAvailable && !p.isGitAvailable) {
            if (p.kind === 'MacOS') {
                specifics =
                    "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, as well as Apple Command Line Tools, which includes the version control system 'Git' that is used by Lean to help manage different versions of Lean formalization packages and software packages."
            } else {
                specifics =
                    "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, as well as the version control system 'Git' that is used by Lean to help manage different versions of Lean formalization packages and software packages."
            }
        } else if (!p.isCurlAvailable && p.isGitAvailable) {
            specifics =
                "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, as well as the file downloader 'Curl' that is sometimes used by Lean tools to query information from the internet."
        } else if (!p.isCurlAvailable && !p.isGitAvailable) {
            specifics =
                "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, the version control system 'Git' that is used by Lean to help manage different versions of Lean formalization packages and software packages, as well as the file downloader 'Curl' that is sometimes used by Lean tools to query information from the internet."
        } else {
            throw new Error('unreachable installationPrompt case')
        }
        return `This command will install Lean. ${specifics}\n\nDo you wish to proceed?`
    }

    private async displayManualInstallationPrompt(
        p: MissingDependencyInstallationProcedure & { method: DependencyInstallationMethod },
    ) {
        if (p.method.script === undefined) {
            await displayModalNotification(
                'Error',
                `Please install ${missingDepsSentence(p)}, restart VS Code and repeat this step to install Lean.`,
            )
            return
        }
        const prompt = `Please install ${missingDepsSentence(p)} from a terminal using the script below, restart VS Code and repeat this step to install Lean.\n\n${p.method.script}`
        const copyToClipboardInput = 'Copy Script to Clipboard'
        const choice = await displayNotificationWithInput('Information', prompt, [copyToClipboardInput], 'Close')
        if (choice === copyToClipboardInput) {
            await env.clipboard.writeText(p.method.script)
        }
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
