import { window, workspace, TerminalOptions, OutputChannel, commands, Disposable, EventEmitter } from 'vscode'
import { executablePath, addServerEnvPaths } from '../config'
import { batchExecute } from './batch'
import { LocalStorageService} from './localStorage'
import { LeanpkgService} from './leanpkg'

export class LeanInstaller implements Disposable {

    private leanInstallerLinux = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh'
    private leanInstallerWindows = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1'
    private defaultLeanVersion : string = null;
    private outputChannel: OutputChannel;
    private localStorage: LocalStorageService;
    private subscriptions: Disposable[] = [];
    private pkgService : LeanpkgService;
    private prompting : boolean = false;

    private installChangedEmitter = new EventEmitter<string>();
    installChanged = this.installChangedEmitter.event

    constructor(outputChannel: OutputChannel, version : string, localStorage : LocalStorageService,
                pkgService : LeanpkgService){
        this.outputChannel = outputChannel;
        this.defaultLeanVersion = version;
        this.localStorage = localStorage;
        this.pkgService = pkgService;
        this.subscriptions.push(commands.registerCommand('lean4.selectToolchain', () => this.selectToolchain()));
    }

    async testLeanVersion() : Promise<string> {
        let executable = this.localStorage.getLeanPath();
        if (!executable) executable = executablePath();
        const found = await this.checkLeanVersion(executable);
        if (found.error) {
            void window.showErrorMessage(found.error);
            // then try something else...
            void this.showInstallOptions();
            return '4'; // we don't know the version, so assume we can make version 4 work.
        }
        return found.version;
    }

    async handleVersionChanged(version : string) :  Promise<void> {
        if (this.prompting) {
            return;
        }
        this.prompting = true;
        const restartItem = 'Restart Lean';
        const item = await window.showErrorMessage(`Lean version changed: '${version}'`, restartItem);
        if (item === restartItem) {
            const rc = await this.testLeanVersion();
            if (rc === '4'){
                // it works, so restart the client!
                this.installChangedEmitter.fire(undefined);
            }
        }
        this.prompting = false;
    }

    async showInstallOptions() : Promise<void> {
        let executable = this.localStorage.getLeanPath();
        if (!executable) executable = executablePath();
        // note; we keep the LeanClient alive so that it can be restarted if the
        // user changes the Lean: Executable Path.
        const installItem = 'Install Lean';
        const selectItem = 'Select Lean Interpreter';
        const item = await window.showErrorMessage(`Failed to start '${executable}' language server`, installItem, selectItem)
        if (item === installItem) {
            try {
                const result = await this.installLean();
                this.installChangedEmitter.fire(undefined);
                // void this.restart();
            } catch (err) {
                this.outputChannel.appendLine(err);
            }
        } else if (item === selectItem){
            void this.selectToolchain();
        }
    }

    async selectToolchain() : Promise<void> {
        let defaultPath = this.localStorage.getLeanPath();
        if (!defaultPath) {
            defaultPath = 'lean';
        }
        const installedToolChains = await this.elanListToolChains();
        const otherPrompt = 'Other...';
        installedToolChains.push(otherPrompt);
        const selectedVersion = await window.showQuickPick(
                installedToolChains, {
                    title: 'Select Lean toolchain',
                    canPickMany: false,
                }
        );
        if (selectedVersion === otherPrompt) {
            const selectedProgram = await window.showInputBox({
                title: 'Enter path',
                value: defaultPath,
                prompt: 'Enter full path to lean toolchain'
            });
            if (selectedProgram) {
                this.localStorage.setLeanPath(selectedProgram);
                this.installChangedEmitter.fire(selectedProgram);
            }
        } else if (selectedVersion) {
            // write this to the leanpkg.toml file and have the new version get
            // picked up from there.
            void this.pkgService.writeLeanVersion(selectedVersion);
        }
    }

    async checkLeanVersion(cmd : string): Promise<{version: string, error: string}> {
        const folders = workspace.workspaceFolders
        let folderPath: string
        if (folders) {
            folderPath = folders[0].uri.fsPath
        }

        const env = addServerEnvPaths(process.env);

        const options = ['--version']
        try {
            // If folderPath is undefined, this will use the process environment for cwd.
            // Specifically, if the extension was not opened inside of a folder, it
            // looks for a global (default) installation of Lean. This way, we can support
            // single file editing.
            const stdout = await batchExecute(cmd, options, folderPath, this.outputChannel)
            const filterVersion = /version (\d+)\.\d+\..+/
            const match = filterVersion.exec(stdout)
            if (!match) {
                if (!stdout) {
                    return { version: '', error: `lean4: '${cmd}' program not found.` }
                } else {
                    return { version: '', error: `lean4: '${cmd} ${options}' returned incorrect version string '${stdout}'.` }
                }
            }
            const major = match[1]
            return { version: major, error: null }
        } catch (err) {
            void window.showErrorMessage(`lean4: Could not find Lean version by running '${cmd} ${options}'.`)
            if (this.outputChannel) this.outputChannel.appendLine(err);
            return { version: '', error: err };
        }
    }

    async elanListToolChains() : Promise<string[]> {
        const folders = workspace.workspaceFolders
        let folderPath: string
        if (folders) {
            folderPath = folders[0].uri.fsPath
        }

        try {
            const cmd = 'elan';
            const options = ['toolchain', 'list'];
            const stdout = await batchExecute(cmd, options, folderPath, null);
            const result : string[] = [];
            stdout.split(/\r?\n/).forEach((s) =>{
                s = s.trim()
                const suffix = ' (default)';
                if (s.endsWith(suffix)){
                    s = s.substr(0, s.length - suffix.length);
                }
                if (s !== '') {
                    result.push(s)
                }
            });
            return result;
        } catch (err) {
            return []
        }
    }

    async installLean() : Promise<boolean> {

        if (executablePath() !== 'lean') {
            this.outputChannel.appendLine('It looks like you\'ve modified the `lean.executablePath` user setting.');
            this.outputChannel.appendLine('Please change it back to \'lean\' before installing elan.');
            return false;
        } else {
            const terminalName = 'Lean installation via elan';

            let elanInstalled = false;
            // See if we have elan already.
            try {
                const options = ['--version']
                const stdout = await batchExecute('elan', options, undefined, this.outputChannel);
                const filterVersion = /elan (\d+)\.\d+\..+/
                const match = filterVersion.exec(stdout)
                if (match) {
                    elanInstalled = true;
                }
            } catch (err) {
                elanInstalled = false;
            }

            let terminalOptions: TerminalOptions = { name: terminalName };
            if (process.platform === 'win32') {
                const windir = process.env.windir
                terminalOptions = { name: terminalName, shellPath: `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` };
            }
            const terminal = window.createTerminal(terminalOptions);
            terminal.show();

            // We register a listener, to restart the Lean extension once elan has finished.
            const result = new Promise<boolean>(function(resolve, reject) {
                window.onDidCloseTerminal((t) => {
                if (t.name === terminalName) {
                    resolve(true);
                }});
            });

            let promptAndExit = 'read -n 1 -s -r -p "Press any key to start Lean" && exit\n'
            if (process.platform === 'win32') {
                promptAndExit = 'Read-Host -Prompt "Press ENTER key to start Lean" ; exit\n'
            }

            // Now show the terminal and run elan.
            if (elanInstalled) {
                // ok, interesting, why did checkLean4 fail then, perhaps elan just needs to be updated?
                terminal.sendText(`elan self update ; ${promptAndExit}\n`);
            }
            else if (process.platform === 'win32') {
                terminal.sendText(
                    `Invoke-WebRequest -Uri "${this.leanInstallerWindows}" -OutFile elan-init.ps1; ` +
                    `.\\elan-init.ps1 --default-toolchain "${this.defaultLeanVersion}" ; ` +
                    `del elan-init.ps1 ; ${promptAndExit}\n`);
            }
            else{
                terminal.sendText(
                    `curl ${this.leanInstallerLinux} -sSf | sh -s -- --default-toolchain ${this.defaultLeanVersion} && ` +
                    `echo && ${promptAndExit}`);
            }

            return result;
        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
