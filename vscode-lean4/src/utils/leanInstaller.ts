import { window, workspace, TerminalOptions, OutputChannel, commands, Disposable, EventEmitter } from 'vscode'
import { executablePath, addServerEnvPaths } from '../config'
import { batchExecute } from './batch'
import { LocalStorageService} from './localStorage'
import { LeanpkgService } from './leanpkg';

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
        let executable = this.localStorage.getLeanPath();
        if (!executable) executable = executablePath();
        // note; we keep the LeanClient alive so that it can be restarted if the
        // user changes the Lean: Executable Path.
        const installItem = 'Install Lean using Elan';
        const selectItem = 'Select Lean Toolchain';
        const item = await window.showErrorMessage(`Failed to start '${executable}' language server`, installItem, selectItem)
        if (item === installItem) {
            try {
                const result = await this.installElan();
                this.installChangedEmitter.fire(undefined);
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
                this.localStorage.setLeanVersion(''); // clear the requested version as we have a full path.
                this.installChangedEmitter.fire(selectedProgram);
            }
        } else if (selectedVersion) {
            // write this to the leanpkg.toml file and have the new version get
            // picked up from there.
            this.localStorage.setLeanPath('lean'); // make sure any local full path override is cleared.
            this.localStorage.setLeanVersion(selectedVersion);
            this.installChangedEmitter.fire(selectedVersion);
        }
    }

    async checkLeanVersion(requestedVersion : string): Promise<{version: string, error: string}> {

        let cmd = this.localStorage.getLeanPath();
        if (!cmd) cmd = executablePath();
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
            this.outputChannel.show(true);
            let stdout = await batchExecute(cmd, options, folderPath, this.outputChannel)
            if (stdout.indexOf('no default toolchain') > 0) {
                this.outputChannel.appendLine('lean4: adding default toolchain version: leanprover/lean4:nightly');
                // this folder has no lean-toolchain file, so let's try and create one.
                await this.pkgService.createLeanToolchain('leanprover/lean4:nightly');
                // try again
                stdout = await batchExecute(cmd, options, folderPath, this.outputChannel)
            }
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

        if (executablePath() !== 'lean') {
            this.outputChannel.show(true);
            this.outputChannel.appendLine('It looks like you\'ve modified the `lean.executablePath` user setting.');
            this.outputChannel.appendLine('Please change it back to \'lean\' before installing elan.');
            return false;
        } else {
            const terminalName = 'Lean installation via elan';

            let elanInstalled = false;
            // See if we have elan already.
            try {
                this.outputChannel.show(true);
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
                    `curl ${this.leanInstallerLinux} -sSf | sh -s -- ${toolchain} && ` +
                    `echo && ${promptAndExit}`);
            }

            return result;
        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
