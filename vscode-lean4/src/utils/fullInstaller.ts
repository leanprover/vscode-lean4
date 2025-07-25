import * as os from 'os'
import { OutputChannel } from 'vscode'
import { SetupDiagnoser } from '../diagnostics/setupDiagnoser'
import { displayNotification } from './notifs'

type LinuxPackageManager =
    | { kind: 'Apt'; isPkExecAvailable: boolean }
    | { kind: 'Dnf'; isPkExecAvailable: boolean }
    | { kind: 'Other' }

type MissingDependencyInstallationProcedure =
    | { kind: 'Linux'; isGitAvailable: boolean; isCurlAvailable: boolean; packageManager: LinuxPackageManager }
    | { kind: 'MacOS'; isGitAvailable: boolean; isCurlAvailable: true }
    | { kind: 'Windows'; isGitAvailable: boolean; isCurlAvailable: true }
    | { kind: 'Other'; isGitAvailable: boolean; isCurlAvailable: boolean }

type DependencyInstallationProcedure = { kind: 'AllDepsInstalled' } | MissingDependencyInstallationProcedure

function missingDeps(p: MissingDependencyInstallationProcedure): string[] {
    const missingDeps = []
    if (!p.isGitAvailable) {
        missingDeps.push('git')
    }
    if (!p.isCurlAvailable) {
        missingDeps.push('curl')
    }
    return missingDeps
}

function dependencyInstallationScript(p: MissingDependencyInstallationProcedure): {
    kind: 'Automatic' | 'Manual'
    shell: 'Windows' | 'Unix'
    script: string | undefined
} {
    switch (p.kind) {
        case 'Linux':
            switch (p.packageManager.kind) {
                case 'Apt':
                    if (!p.packageManager.isPkExecAvailable) {
                        return {
                            kind: 'Manual',
                            shell: 'Unix',
                            script: `sudo apt install ${missingDeps(p).join(' ')}`,
                        }
                    }
                    return {
                        kind: 'Automatic',
                        shell: 'Unix',
                        script: `pkexec apt install ${missingDeps(p).join(' ')}`,
                    }
                case 'Dnf':
                    if (!p.packageManager.isPkExecAvailable) {
                        return {
                            kind: 'Manual',
                            shell: 'Unix',
                            script: `sudo dnf install ${missingDeps(p).join(' ')}`,
                        }
                    }
                    return {
                        kind: 'Automatic',
                        shell: 'Unix',
                        script: `pkexec dnf install ${missingDeps(p).join(' ')}`,
                    }
                case 'Other':
                    return {
                        kind: 'Manual',
                        shell: 'Unix',
                        script: undefined,
                    }
            }
        case 'MacOS':
            return {
                kind: 'Automatic',
                shell: 'Unix',
                script: 'xcode-select --install',
            }
        case 'Windows':
            return {
                kind: 'Automatic',
                shell: 'Windows',
                script: 'winget install -e --id Git.Git',
            }
        case 'Other':
            return {
                kind: 'Manual',
                shell: 'Unix',
                script: undefined,
            }
    }
}

function installationPrompt(p: DependencyInstallationProcedure): string {
    let specifics: string
    if (p.kind === 'AllDepsInstalled' || (p.isCurlAvailable && p.isGitAvailable)) {
        specifics =
            "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system."
    } else if (p.isCurlAvailable && !p.isGitAvailable) {
        if (p.kind === 'MacOS') {
            specifics =
                "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, as well as Apple Command Line Tools."
        } else {
            specifics =
                "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, as well as the version control system 'Git' that can be used to collaborate on Lean projects."
        }
    } else if (!p.isCurlAvailable && p.isGitAvailable) {
        specifics =
            "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, as well as the file downloader 'Curl' that is sometimes used by Lean tools to query information from the internet."
    } else if (!p.isCurlAvailable && !p.isGitAvailable) {
        specifics =
            "Specifically, it will install Lean's version manager 'Elan' that manages all Lean versions on your system, the version control system 'Git' that can be used to collaborate on Lean projects, as well as the file downloader 'Curl' that is sometimes used by Lean tools to query information from the internet."
    } else {
        throw new Error('unreachable installationPrompt case')
    }
    return 'This command will install Lean.\n' + specifics
}

export class FullInstaller {
    private pendingInstall: boolean = false
    private diagnoser: SetupDiagnoser

    constructor(readonly outputChannel: OutputChannel) {
        this.diagnoser = new SetupDiagnoser({
            channel: outputChannel,
            cwdUri: undefined,
            context: 'Dependency Installation',
        })
    }

    async installLean(): Promise<'Success' | 'PendingInstall' | 'Failure'> {
        if (this.pendingInstall) {
            displayNotification('Error', 'Lean is already being installed.')
            return 'PendingInstall'
        }
        this.pendingInstall = true
        try {
            displayNotification('Information')
        } finally {
            this.pendingInstall = false
        }
    }

    private async determineDependencyInstallationProcedure(): Promise<DependencyInstallationProcedure> {
        const isCurlAvailable = await this.diagnoser.checkCurlAvailable()
        const isGitAvailable = await this.diagnoser.checkGitAvailable()
        if (isCurlAvailable && isGitAvailable) {
            return { kind: 'AllDepsInstalled' }
        }

        switch (os.type()) {
            case 'Linux':
                const isAptAvailable = await this.diagnoser.checkAptAvailable()
                if (isAptAvailable) {
                    const isPkExecAvailable = await this.diagnoser.checkPkExecAvailable()
                    return {
                        kind: 'Linux',
                        isCurlAvailable,
                        isGitAvailable,
                        packageManager: { kind: 'Apt', isPkExecAvailable },
                    }
                }
                const isDnfAvailable = await this.diagnoser.checkDnfAvailable()
                if (isDnfAvailable) {
                    const isPkExecAvailable = await this.diagnoser.checkPkExecAvailable()
                    return {
                        kind: 'Linux',
                        isCurlAvailable,
                        isGitAvailable,
                        packageManager: { kind: 'Dnf', isPkExecAvailable },
                    }
                }
                return {
                    kind: 'Linux',
                    isCurlAvailable,
                    isGitAvailable,
                    packageManager: { kind: 'Other' },
                }
            case 'Darwin':
                return {
                    kind: 'MacOS',
                    isCurlAvailable: true,
                    isGitAvailable,
                }
            case 'Windows_NT':
                return {
                    kind: 'Windows',
                    isCurlAvailable: true,
                    isGitAvailable,
                }
        }
        return {
            kind: 'Other',
            isCurlAvailable,
            isGitAvailable,
        }
    }
}
