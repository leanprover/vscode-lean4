import { window, TerminalOptions, OutputChannel, commands, Disposable, EventEmitter, ProgressLocation } from 'vscode'
import { toolchainPath, addServerEnvPaths } from '../config'
import { batchExecute } from './batch'
import { LocalStorageService} from './localStorage'
import { LeanpkgService } from './leanpkg';
import { join } from 'path';

export class LeanInstaller implements Disposable {

    private leanInstallerLinux = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh'
    private leanInstallerWindows = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1'
    private outputChannel: OutputChannel;
    private localStorage: LocalStorageService;
    private subscriptions: Disposable[] = [];
    private prompting : boolean = false;
    private pkgService : LeanpkgService;

    private installChangedEmitter = new EventEmitter<string>();
    installChanged = this.installChangedEmitter.event

    constructor(outputChannel: OutputChannel, localStorage : LocalStorageService, pkgService : LeanpkgService){
        this.outputChannel = outputChannel;
        this.localStorage = localStorage;
        this.pkgService = pkgService;
        this.subscriptions.push(commands.registerCommand('lean4.selectToolchain', () => this.selectToolchain()));
    }

    async testLeanVersion(requestedVersion : string) : Promise<string> {
        const found = await this.checkLeanVersion(requestedVersion);
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
            const rc = await this.testLeanVersion(version);
            if (rc === '4'){
                // it works, so restart the client!
                this.installChangedEmitter.fire(undefined);
            }
        }
        this.prompting = false;
    }

    async showInstallOptions() : Promise<void> {
        let path = this.localStorage.getLeanPath();
        if (!path) path = toolchainPath();
        // note; we keep the LeanClient alive so that it can be restarted if the
        // user changes the Lean: Executable Path.
        const installItem = 'Install Lean using Elan';
        const selectItem = 'Select Lean Toolchain';
        let prompt = `Failed to start 'lean' language server`
        if (path){
            prompt += `from ${path}`
        }
        const item = await window.showErrorMessage(prompt, installItem, selectItem)
        if (item === installItem) {
            try {
                const result = await this.installElan();
                this.installChangedEmitter.fire(undefined);
            } catch (err) {
                this.outputChannel.appendLine('' + err);
            }
        } else if (item === selectItem){
            void this.selectToolchain();
        }
    }

    async selectToolchain() : Promise<void> {
        let defaultPath = this.localStorage.getLeanPath();
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
            const selectedPath = await window.showInputBox({
                title: 'Enter custom toolchain path',
                value: defaultPath,
                prompt: 'Enter full path to the lean toolchain you want to use or leave blank to use the default path',
            });
            this.localStorage.setLeanPath(selectedPath);
            this.localStorage.setLeanVersion(''); // clear the requested version as we have a full path.
            this.installChangedEmitter.fire(selectedPath);
        } else if (selectedVersion) {
            // write this to the leanpkg.toml file and have the new version get
            // picked up from there.
            this.localStorage.setLeanPath(''); // make sure any local full path override is cleared.
            this.localStorage.setLeanVersion(selectedVersion);
            this.installChangedEmitter.fire(selectedVersion);
        }
    }

    async checkLeanVersion(requestedVersion : string): Promise<{version: string, error: string}> {

        let cmd = this.localStorage.getLeanPath();
        if (!cmd) cmd = toolchainPath();
        if (!cmd) {
            cmd = 'lean'
        } else {
            cmd = join(cmd, 'lean')
        }
        // if this workspace has a local override use it, otherwise fall back on the requested version.
        const version = this.localStorage.getLeanVersion() ?? requestedVersion;

        const folderUri = this.pkgService.getWorkspaceLeanFolderUri();
        let folderPath: string
        if (folderUri) {
            folderPath = folderUri.fsPath
        }

        const env = addServerEnvPaths(process.env);

        let options = ['--version']
        if (version) {
            // user is requesting an explicit version!
            options = ['+' + version, '--version']
        }
        try {
            // If folderPath is undefined, this will use the process environment for cwd.
            // Specifically, if the extension was not opened inside of a folder, it
            // looks for a global (default) installation of Lean. This way, we can support
            // single file editing.
            let stdout = '';
            let inc = 0;
            await window.withProgress({
                location: ProgressLocation.Notification,
                title: '',
                cancellable: false
            }, (progress) => {
                const progressChannel : OutputChannel = {
                    name : 'ProgressChannel',
                    append(value: string)
                    {
                        stdout += value;
                        console.log(inc + ': ' + value);
                        if (inc < 100) {
                            inc += 10;
                        }
                        progress.report({ increment: inc, message: value });
                    },
                    appendLine(value: string) {
                        this.append(value + '\n');
                    },
                    clear() { /* empty */ },
                    show() { /* empty */ },
                    hide() { /* empty */ },
                    dispose() { /* empty */ }
                }
                progress.report({increment:0, message: 'Checking Lean setup...'});
                return batchExecute(cmd, options, folderPath, progressChannel);
            });

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
            if (this.outputChannel) this.outputChannel.appendLine('' + err);
            return { version: '', error: err };
        }
    }

    async elanListToolChains() : Promise<string[]> {

        const folderUri = this.pkgService.getWorkspaceLeanFolderUri();
        let folderPath: string
        if (folderUri) {
            folderPath = folderUri.fsPath
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

    async installElan() : Promise<boolean> {
        if (toolchainPath()) {
            void window.showErrorMessage('It looks like you\'ve modified the `lean.toolchainPath` user setting.' +
                                         'Please clear this setting before installing elan.');
            return false;
        } else {
            const terminalName = 'Lean installation via elan';

            let elanInstalled = false;
            // See if we have elan already.
            try {
                const options = ['--version']
                const stdout = await batchExecute('elan', options, undefined, null);
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

            // we try not to mess with the --default-toolchain and only install the minimum
            // # of toolchains to get this user up and running on the workspace they are opening.
            const toolchain = '-y --default-toolchain none';

            // Now show the terminal and run elan.
            if (elanInstalled) {
                // ok, interesting, why did checkLean4 fail then, perhaps elan just needs to be updated?
                terminal.sendText(`elan self update ; ${promptAndExit}\n`);
            }
            else if (process.platform === 'win32') {
                terminal.sendText(
                    `Invoke-WebRequest -Uri "${this.leanInstallerWindows}" -OutFile elan-init.ps1; ` +
                    `.\\elan-init.ps1 "${toolchain}" ; ` +
                    `del elan-init.ps1 ; ${promptAndExit}\n`);
            }
            else{
                terminal.sendText(
                    `bash -c 'curl ${this.leanInstallerLinux} -sSf | sh -s -- ${toolchain} && ` +
                    `echo && ${promptAndExit}'`);
            }

            return result;
        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
