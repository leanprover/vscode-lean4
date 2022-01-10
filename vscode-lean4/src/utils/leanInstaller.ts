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
    private defaultToolchain : string;
    private workspaceSuffix : string = '(workspace override)';
    private defaultSuffix : string = '(default)'

    private installChangedEmitter = new EventEmitter<string>();
    installChanged = this.installChangedEmitter.event

    constructor(outputChannel: OutputChannel, localStorage : LocalStorageService, pkgService : LeanpkgService, defaultToolchain : string) {
        this.outputChannel = outputChannel;
        this.defaultToolchain = defaultToolchain;
        this.localStorage = localStorage;
        this.pkgService = pkgService;
        this.subscriptions.push(commands.registerCommand('lean4.selectToolchain', () => this.selectToolchain()));
    }

    async testLeanVersion() : Promise<{version: string, error: string}> {

        // see if there is a lean-toolchain file and use that version.
        let leanVersion = await this.pkgService.findLeanPkgVersionInfo();
        if (!leanVersion) {
            // see if there's a workspace override then.
            leanVersion = this.localStorage.getLeanVersion();
        }

        if (!leanVersion){
            const hasElan = await this.hasElan();
            if (!hasElan) {
                // Ah, then we need to install elan and since we have no leanVersion
                // we might as well install the default toolchain as well.
                void this.showInstallOptions();
                return { version: '4', error: 'no elan installed' }
            } else {
                const defaultVersion = await this.getDefaultToolchain();
                if (!defaultVersion) {
                    void this.showToolchainOptions();
                } else {
                    leanVersion = defaultVersion;
                }
            }
        }

        const found = await this.checkLeanVersion(leanVersion);
        if (found.error) {
            if (leanVersion){
                // if we have a lean-toolchain version or a workspace override then
                // use that version during the installElan process.
                this.defaultToolchain = leanVersion;
            }
            if (found.error === 'no default toolchain') {
                await this.showToolchainOptions()
            } else {
                void this.showInstallOptions();
            }
        }
        return found;
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
            if (rc.version === '4'){
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
        let prompt = 'Failed to start \'lean\' language server'
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
        const installedToolChains = await this.elanListToolChains();
        if (installedToolChains.length === 1 && installedToolChains[0] === 'no installed toolchains') {
            installedToolChains[0] = this.defaultToolchain
        }

        // give an indication of any workspace override.
        const resetPrompt = 'Reset workspace override...';
        const versionOverride = this.localStorage.getLeanVersion();
        const toolchainOverride = this.localStorage.getLeanPath();
        if (versionOverride){
            let found = false;
            for (let i = 0; i < installedToolChains.length; i++)
            {
                const v = this.removeSuffix(installedToolChains[i]);
                if (v === versionOverride){
                    installedToolChains[i] = v + ' ' + this.workspaceSuffix;
                    found = true;
                }
            }

            if (!found) {
                installedToolChains.push(versionOverride + ' ' + this.workspaceSuffix);
            }
            installedToolChains.push(resetPrompt);
        }
        else if (toolchainOverride){
            installedToolChains.push(resetPrompt);
        }

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
                value: this.localStorage.getLeanPath(),
                prompt: 'Enter full path to the lean toolchain you want to use or leave blank to use the default path',
            });
            this.localStorage.setLeanPath(selectedPath);
            this.localStorage.setLeanVersion(''); // clear the requested version as we have a full path.
            this.installChangedEmitter.fire(selectedPath);
        } else if (selectedVersion === resetPrompt){
            this.localStorage.setLeanPath('') // clear any toolchain path override.
            this.localStorage.setLeanVersion(''); // clear the requested version as we have a full path.
            this.installChangedEmitter.fire(undefined);
        } else if (selectedVersion) {
            const s = this.removeSuffix(selectedVersion);
            this.localStorage.setLeanPath(''); // make sure any local full path override is cleared.
            this.localStorage.setLeanVersion(s);
            this.installChangedEmitter.fire(s);
        }
    }

    private removeSuffix(version: string): string{
        let s = version;
        const suffixes = [this.defaultSuffix, this.workspaceSuffix];
        suffixes.forEach((suffix) => {
            if (s.endsWith(suffix)){
                s = s.substr(0, s.length - suffix.length);
            }
        });
        return s.trim();
    }

    async showToolchainOptions() : Promise<void> {
        const selectToolchain = 'Select lean toolchain';
        const item = await window.showErrorMessage('You have no default "lean-toolchain" in this folder or any parent folder.', selectToolchain)
        if (item === selectToolchain) {
            await this.selectToolchain();
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
            const stdout = await this.executeWithProgress('Checking Lean setup...', cmd, options,folderPath)
            if (!stdout) {
                return { version: '', error: 'lean not found' };
            }
            if (stdout.indexOf('no default toolchain') > 0) {
                return { version: '', error: 'no default toolchain' };
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
            if (this.outputChannel) this.outputChannel.appendLine('' + err);
            return { version: '', error: err };
        }
    }

    private async executeWithProgress(prompt: string, cmd: string, options: string[], workingDirectory: string): Promise<string>{
        let inc = 0;
        let stdout = ''
        /* eslint-disable  @typescript-eslint/no-this-alias */
        const realThis = this;
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
                    if (realThis.outputChannel){
                        // add the output here in case user wants to go look for it.
                        realThis.outputChannel.appendLine(value.trim());
                    }
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
            progress.report({increment:0, message: prompt});
            return batchExecute(cmd, options, workingDirectory, progressChannel);
        });
        return stdout;
    }

    async getDefaultToolchain(): Promise<string> {
        const toolChains = await this.elanListToolChains();
        let result :string = ''
        toolChains.forEach((s) => {
            if (s.endsWith(this.defaultSuffix)){
                result = this.removeSuffix(s);
            }
        });
        return result;
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
            if (!stdout){
                throw new Error('elan toolchain list returned no output.');
            }
            const result : string[] = [];
            stdout.split(/\r?\n/).forEach((s) =>{
                s = s.trim()
                if (s !== '') {
                    result.push(s)
                }
            });
            return result;
        } catch (err) {
            return ['error']
        }
    }

    async hasElan() : Promise<boolean> {
        let elanInstalled = false;
        // See if we have elan already.
        try {
            const options = ['--version']
            const stdout = await this.executeWithProgress('Checking Elan setup...', 'elan', options, undefined)
            const filterVersion = /elan (\d+)\.\d+\..+/
            const match = filterVersion.exec(stdout)
            if (match) {
                elanInstalled = true;
            }
        } catch (err) {
            elanInstalled = false;
        }
        return elanInstalled;
    }

    private async installElan() : Promise<boolean> {
        if (toolchainPath()) {
            void window.showErrorMessage('It looks like you\'ve modified the `lean.toolchainPath` user setting.' +
                                         'Please clear this setting before installing elan.');
            return false;
        } else {
            const terminalName = 'Lean installation via elan';

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

            const toolchain = `-y --default-toolchain ${this.defaultToolchain}`;

            // Now show the terminal and run elan.
            if (await this.hasElan()) {
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
