import * as os from 'os'
import { OutputChannel } from 'vscode'
import { SetupDiagnoser } from '../diagnostics/setupDiagnoser'
import {
    batchExecuteWithProgress,
    displayResultError,
    ExecutionExitCode,
    ExecutionResult,
    ProgressExecutionOptions,
} from './batch'
import { displayModalNotification, displayNotification, displayNotificationWithInput } from './notifs'

function sentenceJoin(entries: string[]): string {
    if (entries.length === 0) {
        throw new Error('Cannot join empty array.')
    }
    if (entries.length === 1) {
        return entries[0]
    }
    if (entries.length === 2) {
        return `${entries[0]} and ${entries[1]}`
    }
    return `${entries.slice(0, entries.length - 1).join(', ')} and ${entries[entries.length - 1]}`
}

const pkExecNotInstalled = (installCmd: string, missingDeps: string[]) =>
    `Cannot automatically install dependencies because the \`pkexec\` utility is not installed, which is used to safely enter credentials for the installation.
Please install ${sentenceJoin(missingDeps.map(d => '`' + d + '`'))} from a terminal via \`sudo ${installCmd} ${missingDeps.join(' ')}\`, restart VS Code and re-try this step.`

type DependencyInstallation =
    | {
          kind: 'InstallDeps'
          script: string
          explanation: string
          shell: 'Windows' | 'Unix'
      }
    | {
          kind: 'AllDepsInstalled'
      }
    | {
          kind: 'ManualInstall'
          msg: string
      }

export class DepInstaller {
    private pendingInstall: boolean = false
    private diagnoser: SetupDiagnoser

    constructor(readonly outputChannel: OutputChannel) {
        this.diagnoser = new SetupDiagnoser({
            channel: outputChannel,
            cwdUri: undefined,
            context: 'Dependency Installation',
        })
    }

    private async determineMissingDeps(): Promise<string[]> {
        const missingDeps = []
        const isCurlAvailable = await this.diagnoser.checkCurlAvailable()
        if (!isCurlAvailable) {
            missingDeps.push('curl')
        }
        const isGitAvailable = await this.diagnoser.checkGitAvailable()
        if (!isGitAvailable) {
            missingDeps.push('git')
        }
        return missingDeps
    }

    private async determineDependencyInstallation(): Promise<DependencyInstallation> {
        const missingDeps = await this.determineMissingDeps()
        if (missingDeps.length === 0) {
            return { kind: 'AllDepsInstalled' }
        }

        switch (os.type()) {
            case 'Linux':
                const isAptAvailable = await this.diagnoser.checkAptAvailable()
                if (isAptAvailable) {
                    const isPkExecAvailable = await this.diagnoser.checkPkExecAvailable()
                    if (!isPkExecAvailable) {
                        return {
                            kind: 'ManualInstall',
                            msg: pkExecNotInstalled('apt install', missingDeps),
                        }
                    }
                    const linuxScript = `pkexec apt install ${missingDeps.join(' ')}`
                    return {
                        kind: 'InstallDeps',
                        script: linuxScript,
                        shell: 'Unix',
                        explanation: `This command will install ${sentenceJoin(missingDeps)} by running \`${linuxScript}\`. \`pkexec\` is used to safely enter your credentials for the installation and \`apt install\` is used to perform the installation.`,
                    }
                }
                const isDnfAvailable = await this.diagnoser.checkDnfAvailable()
                if (isDnfAvailable) {
                    const isPkExecAvailable = await this.diagnoser.checkPkExecAvailable()
                    if (!isPkExecAvailable) {
                        return {
                            kind: 'ManualInstall',
                            msg: pkExecNotInstalled('apt install', missingDeps),
                        }
                    }
                    const linuxScript = `pkexec dnf install ${missingDeps.join(' ')}`
                    return {
                        kind: 'InstallDeps',
                        script: linuxScript,
                        shell: 'Unix',
                        explanation: `This command will install ${sentenceJoin(missingDeps.map(d => '`' + d + '`'))} by running \`${linuxScript}\`. \`pkexec\` is used to safely enter your credentials for the installation and \`dnf install\` is used to perform the installation.`,
                    }
                }
                return {
                    kind: 'ManualInstall',
                    msg: `Please install ${sentenceJoin(missingDeps.map(d => '`' + d + '`'))} using your package manager, restart VS Code and re-try this step.`,
                }
            case 'Darwin':
                const macOsScript = 'xcode-select --install'
                return {
                    kind: 'InstallDeps',
                    script: macOsScript,
                    shell: 'Unix',
                    explanation: `This command will install the Apple Command Line Tools by running \`${macOsScript}\`.`,
                }
            case 'Windows_NT':
                const windowsScript = 'winget install -e --id Git.Git'
                return {
                    kind: 'InstallDeps',
                    script: windowsScript,
                    shell: 'Windows',
                    explanation: 'This command will install `git` by running `${windowsScript}`.',
                }
        }

        return {
            kind: 'ManualInstall',
            msg: `Please install ${sentenceJoin(missingDeps.map(d => '`' + d + '`'))} using your package manager, restart VS Code and re-try this step.`,
        }
    }

    async installDependencies(): Promise<'Success' | 'PendingInstall' | 'Failure'> {
        if (this.pendingInstall) {
            displayNotification('Error', 'Dependencies are already being installed.')
            return 'PendingInstall'
        }
        this.pendingInstall = true
        try {
            const dependencyInstallation = await this.determineDependencyInstallation()
            switch (dependencyInstallation.kind) {
                case 'InstallDeps':
                    const choice = await displayNotificationWithInput(
                        'Information',
                        dependencyInstallation.explanation + '\n\n Do you wish to proceed?',
                        ['Proceed'],
                    )
                    if (choice !== 'Proceed') {
                        return 'Failure'
                    }
                    const installationResult = await this.runCommand(
                        dependencyInstallation.script,
                        [],
                        'Installing missing dependencies',
                        dependencyInstallation.shell,
                    )
                    switch (installationResult.exitCode) {
                        case ExecutionExitCode.Success:
                            displayNotification('Information', 'Dependency installation successful!')
                            return 'Success'
                        case ExecutionExitCode.CannotLaunch:
                            displayNotification(
                                'Error',
                                `Cannot run installation script \`${dependencyInstallation.script}\`.`,
                            )
                            return 'Failure'
                        case ExecutionExitCode.ExecutionError:
                            displayResultError(
                                installationResult,
                                `Cannot run installation script \`${dependencyInstallation.script}\`.`,
                            )
                            return 'Failure'
                        case ExecutionExitCode.Cancelled:
                            return 'Failure'
                    }
                case 'AllDepsInstalled':
                    return 'Success'
                case 'ManualInstall':
                    await displayModalNotification('Information', dependencyInstallation.msg)
                    return 'Failure'
            }
        } finally {
            this.pendingInstall = false
        }
    }

    private async runCommand(
        executablePath: string,
        args: string[],
        title: string,
        shell?: 'Unix' | 'Windows' | undefined,
    ): Promise<ExecutionResult> {
        const options: ProgressExecutionOptions = {
            allowCancellation: true,
            channel: this.outputChannel,
            shell,
        }
        return batchExecuteWithProgress(executablePath, args, 'Dependency Installation', title, options)
    }
}
