import { EventEmitter, OutputChannel, TerminalOptions, window } from 'vscode'
import { getPowerShellPath, isRunningTest } from '../config'
import { batchExecute } from './batch'
import { ExtUri, FileUri } from './exturi'
import { logger } from './logger'

export class LeanVersion {
    version: string
    error: string | undefined
}

export class LeanInstaller {
    private leanInstallerLinux = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh'
    private leanInstallerWindows = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1'
    private outputChannel: OutputChannel
    private prompting: boolean = false
    private installing: boolean = false
    private freshInstallDefaultToolchain: string
    private elanDefaultToolchain: string = '' // the default toolchain according to elan (toolchain marked with '(default)')
    private workspaceSuffix: string = '(workspace override)'
    private defaultSuffix: string = '(default)'
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

    async handleVersionChanged(packageUri: FileUri): Promise<void> {
        if (!this.promptUser) {
            this.installChangedEmitter.fire(packageUri)
            return
        }

        if (this.prompting) {
            return
        }

        const restartItem = 'Restart Lean'
        const item = await this.showPrompt('Lean version changed', restartItem)
        if (item === restartItem) {
            this.installChangedEmitter.fire(packageUri)
        }
    }

    isPromptVisible() {
        return this.prompting
    }

    private async showPrompt(message: string, ...items: string[]): Promise<string | undefined> {
        this.prompting = true
        const item = await window.showErrorMessage(message, ...items)
        this.prompting = false
        return item
    }

    async handleLakeFileChanged(packageUri: FileUri): Promise<void> {
        if (!this.promptUser) {
            this.installChangedEmitter.fire(packageUri)
            return
        }

        if (this.prompting) {
            return
        }

        const restartItem = 'Restart Lean'
        const item = await this.showPrompt('Lake file configuration changed', restartItem)
        if (item === restartItem) {
            this.installChangedEmitter.fire(packageUri)
        }
    }

    private removeSuffix(version: string): string {
        let s = version
        const suffixes = [this.defaultSuffix, this.workspaceSuffix]
        suffixes.forEach(suffix => {
            if (s.endsWith(suffix)) {
                s = s.substr(0, s.length - suffix.length)
            }
        })
        return s.trim()
    }

    async getElanDefaultToolchain(packageUri: ExtUri): Promise<string> {
        if (this.elanDefaultToolchain) {
            return this.elanDefaultToolchain
        }

        const toolChains = await this.elanListToolChains(packageUri)
        let result: string = ''
        toolChains.forEach(s => {
            if (s.endsWith(this.defaultSuffix)) {
                result = this.removeSuffix(s)
            }
        })

        this.elanDefaultToolchain = result
        return result
    }

    async elanListToolChains(packageUri: ExtUri): Promise<string[]> {
        try {
            const cmd = 'elan'
            const options = ['toolchain', 'list']
            const cwd = packageUri.scheme === 'file' ? packageUri.fsPath : undefined
            const stdout = (await batchExecute(cmd, options, cwd)).stdout
            if (!stdout) {
                throw new Error('elan toolchain list returned no output.')
            }
            const result: string[] = []
            stdout.split(/\r?\n/).forEach(s => {
                s = s.trim()
                if (s !== '') {
                    result.push(s)
                }
            })
            return result
        } catch (err) {
            return [`${err}`]
        }
    }

    async hasElan(): Promise<boolean> {
        try {
            const options = ['--version']
            const result = await batchExecute('elan', options)
            const filterVersion = /elan (\d+)\.\d+\..+/
            const match = filterVersion.exec(result.stdout)
            return match !== null
        } catch (err) {
            return false
        }
    }

    async autoInstall(): Promise<void> {
        logger.log('[LeanInstaller] Installing Elan ...')
        await this.installElan()
        logger.log('[LeanInstaller] Elan installed')
    }

    async installElan(): Promise<'Success' | 'InstallationFailed' | 'PendingInstallation'> {
        if (this.installing) {
            void window.showErrorMessage('Elan is already being installed.')
            return 'PendingInstallation'
        }
        this.installing = true

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
                    logger.log('[LeanInstaller] ignoring terminal closed: ' + t.name + ', waiting for: ' + terminalName)
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
        this.elanDefaultToolchain = this.freshInstallDefaultToolchain
        this.installing = false
        if (!result) {
            void window.showErrorMessage('Elan installation failed. Check the terminal output for errors.')
            return 'InstallationFailed'
        }

        return 'Success'
    }
}
