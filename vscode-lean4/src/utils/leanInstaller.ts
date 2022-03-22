import { window, TerminalOptions, OutputChannel, commands, Disposable, EventEmitter, ProgressLocation, Uri } from 'vscode'
import { toolchainPath, addServerEnvPaths, getLeanExecutableName  } from '../config'
import { batchExecute } from './batch'
import { LocalStorageService} from './localStorage'
import { LeanpkgService } from './leanpkg'
import { readLeanVersion, findLeanPackageRoot, isCoreLean4Directory } from './projectInfo';
import { join, dirname } from 'path';
import { fileExists } from './fsHelper'

export class LeanVersion {
    version: string;
    error: string | undefined;
}

export class LeanInstaller implements Disposable {

    private leanInstallerLinux = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh'
    private leanInstallerWindows = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.ps1'
    private outputChannel: OutputChannel;
    private localStorage: LocalStorageService;
    private subscriptions: Disposable[] = [];
    private prompting : boolean = false;
    private defaultToolchain : string;
    private workspaceSuffix : string = '(workspace override)';
    private defaultSuffix : string = '(default)'
    private versionCache: Map<string,string> = new Map();
    private promptUser : boolean = true;

    // This event is raised whenever a version change happens.
    // The event provides the workspace Uri where the change happened.
    private installChangedEmitter = new EventEmitter<Uri>();
    installChanged = this.installChangedEmitter.event

    constructor(outputChannel: OutputChannel, localStorage : LocalStorageService, defaultToolchain : string) {
        this.outputChannel = outputChannel;
        this.defaultToolchain = defaultToolchain;
        this.localStorage = localStorage;
        this.subscriptions.push(commands.registerCommand('lean4.selectToolchain', (args) => this.selectToolchainForActiveEditor(args)));
    }

    setPromptUser(show: boolean) {
        this.promptUser = show;
    }

    async testLeanVersion(packageUri: Uri) : Promise<LeanVersion> {
        // see if there is a lean-toolchain file and use that version info.
        let leanVersion : string | null = await readLeanVersion(packageUri);
        if (!leanVersion) {
            // see if there's a workspace override then.
            leanVersion = this.localStorage.getLeanVersion();
        }

        if (!leanVersion){
            const hasElan = await this.hasElan();
            if (!hasElan) {
                // Ah, then we need to install elan and since we have no leanVersion
                // we might as well install the default toolchain as well.
                void this.showInstallOptions(packageUri);
                return { version: '4', error: 'no elan installed' }
            } else if (! await isCoreLean4Directory(packageUri)) {
                const defaultVersion = await this.getDefaultToolchain(packageUri);
                if (!defaultVersion) {
                    void this.showToolchainOptions(packageUri);
                } else {
                    leanVersion = defaultVersion;
                }
            }
        }

        const found = await this.checkLeanVersion(packageUri, leanVersion);
        if (found.error) {
            if (leanVersion){
                // if we have a lean-toolchain version or a workspace override then
                // use that version during the installElan process.
                this.defaultToolchain = leanVersion;
            }
            if (found.error === 'no default toolchain') {
                await this.showToolchainOptions(packageUri)
            } else {
                void this.showInstallOptions(packageUri);
            }
        }
        return found;
    }

    async handleVersionChanged(packageUri : Uri) :  Promise<void> {
        if (packageUri && packageUri.scheme === 'file'){
            const key = packageUri.fsPath;
            if (this.versionCache.has(key)) {
                this.versionCache.delete(key);
            }
        }

        if (this.localStorage.getLeanVersion()){
            // user has a local workspace override in effect, we don't care
            // if the lean-toolchain is modified.
            return;
        }

        if (this.promptUser){
            if (this.prompting) {
                return;
            }
            this.prompting = true;
            const restartItem = 'Restart Lean';
            const item = await window.showErrorMessage('Lean version changed', restartItem);
            if (item === restartItem) {
                await this.checkAndFire(packageUri);
            }
            this.prompting = false;
        } else {
            await this.checkAndFire(packageUri);
        }
    }

    private async checkAndFire(packageUri : Uri) {
        const rc = await this.testLeanVersion(packageUri);
        if (rc.version === '4'){
            // it works, so restart the client!
            this.installChangedEmitter.fire(packageUri);
        }
    }

    async handleLakeFileChanged(uri: Uri) :  Promise<void> {
        if (this.promptUser){
            if (this.prompting) {
                return;
            }
            this.prompting = true;
            const restartItem = 'Restart Lean';
            const item = await window.showErrorMessage('Lake file configuration changed', restartItem);
            if (item === restartItem) {
                this.installChangedEmitter.fire(uri);
            }
            this.prompting = false;
        } else {
            this.installChangedEmitter.fire(uri);
        }
    }

    async showInstallOptions(uri: Uri) : Promise<void> {
        let path  = this.localStorage.getLeanPath();
        if (!path ) path  = toolchainPath();
        // note; we keep the LeanClient alive so that it can be restarted if the
        // user changes the Lean: Executable Path.
        const installItem = 'Install Lean using Elan';
        const selectItem = 'Select Lean Toolchain';
        let prompt = 'Failed to start \'lean\' language server'
        if (path){
            prompt += ` from ${path}`
        }

        const item = await window.showErrorMessage(prompt, installItem, selectItem)
        if (item === installItem) {
            try {
                const result = await this.installElan();
                this.installChangedEmitter.fire(uri);
            } catch (err) {
                this.outputChannel.appendLine('' + err);
            }
        } else if (item === selectItem){
            void this.selectToolchain(uri);
        }
    }

    async selectToolchainForActiveEditor(args : any) : Promise<void> {
        if (window.activeTextEditor) {
            const uri = window.activeTextEditor.document.uri;
            if (args) {
                // this is a test codepath that short circuits the UI.
                const selectedVersion = args as string;
                let s = this.removeSuffix(selectedVersion);
                console.log('selectToolchainForActiveEditor: ' + selectedVersion);
                if (s === 'reset') {
                    s = '';
                }
                this.localStorage.setLeanPath(''); // make sure any local full path override is cleared.
                this.localStorage.setLeanVersion(s); // request the specified version.
                this.installChangedEmitter.fire(uri);
            }
            else {
                await this.selectToolchain(uri);
            }
        }
    }

    async selectToolchain(uri: Uri) : Promise<void> {
        const [workspaceFolder, folderUri, packageFileUri] = await findLeanPackageRoot(uri);
        const installedToolChains = await this.elanListToolChains(folderUri);
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
            const selectedPath  = await window.showInputBox({
                title: 'Enter custom toolchain path',
                value: this.localStorage.getLeanPath(),
                prompt: 'Enter full path to the lean toolchain you want to use or leave blank to use the default path'
            });
            if (selectedPath) {
                const toolchainPath = await this.checkToolchainPath(selectedPath);
                if (toolchainPath) {
                    this.localStorage.setLeanPath(toolchainPath);
                    this.localStorage.setLeanVersion(''); // clear the requested version as we have a full path.
                    this.installChangedEmitter.fire(uri);
                }
            }
        }  else if (selectedVersion === resetPrompt){
            this.localStorage.setLeanPath(''); // make sure any local full path override is cleared.
            this.localStorage.setLeanVersion(''); // clear any custom version.
            this.installChangedEmitter.fire(uri);
        } else if (selectedVersion) {
            const s = this.removeSuffix(selectedVersion);
            this.localStorage.setLeanPath(''); // make sure any local full path override is cleared.
            this.localStorage.setLeanVersion(s); // request the specified version.
            this.installChangedEmitter.fire(uri);
        }
    }

    private async checkToolchainPath(path: string) : Promise<string | null> {
        let leanProgram = join(path, getLeanExecutableName());
        if (await fileExists(leanProgram)) {
            // then we want the parent folder.
            path = dirname(path);
        }

        const binFolder = join(path, 'bin');
        if (await fileExists(binFolder)) {
            // ensure the lean program exists inside.
            leanProgram = join(binFolder, getLeanExecutableName());
            if (await fileExists(leanProgram)) {
                return path;
            }
            void window.showErrorMessage(`Lean program not found in ${binFolder}`);
        }
        else {
            void window.showErrorMessage('Lean toolchain should contain a \'bin\' folder');
        }
        return null;
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

    async showToolchainOptions(uri: Uri) : Promise<void> {
        // note; we keep the LeanClient alive so that it can be restarted if the
        // user changes the Lean: Executable Path.
        const selectToolchain = 'Select lean toolchain';
        const item = await window.showErrorMessage('You have no default "lean-toolchain" in this folder or any parent folder.', selectToolchain)
        if (item === selectToolchain) {
            await this.selectToolchain(uri);
        }
    }

    async checkLeanVersion(packageUri: Uri | null, requestedVersion : string): Promise<LeanVersion> {

        let cmd = this.localStorage.getLeanPath();
        if (!cmd) cmd = toolchainPath();
        if (!cmd) {
            cmd = 'lean'
        } else {
            cmd = join(cmd, 'bin', 'lean')
        }
        // if this workspace has a local override use it, otherwise fall back on the requested version.
        let version = this.localStorage.getLeanVersion();
        if (!version || version === '') {
            version = requestedVersion;
        }

        let folderPath: string = '';
        const scheme = packageUri?.scheme
        if (scheme === 'scheme') {
            // assume untitled files are version 4?  Actually no...
            return { version: '4', error: undefined };
        }
        if (scheme === 'file' && packageUri) {
            folderPath = packageUri.fsPath;
            if (this.versionCache.has(folderPath)) {
                const version = this.versionCache.get(folderPath);
                if (version){
                    return { version, error: undefined }
                }
            }
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
            const stdout = await this.executeWithProgress('Checking Lean setup...', cmd, options, folderPath)
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
            const major = match[1];
            this.versionCache.set(folderPath, major);
            return { version: major, error: undefined }
        } catch (err) {
            if (this.outputChannel) this.outputChannel.appendLine('' + err);
            return { version: '', error: err };
        }
    }

    private async executeWithProgress(prompt: string, cmd: string, options: string[], workingDirectory: string | null): Promise<string>{
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
                replace(value: string) { /* empty */ },
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

    async getDefaultToolchain(packageUri: Uri): Promise<string> {
        const toolChains = await this.elanListToolChains(packageUri);
        let result :string = ''
        toolChains.forEach((s) => {
            if (s.endsWith(this.defaultSuffix)){
                result = this.removeSuffix(s);
            }
        });
        return result;
    }

    async elanListToolChains(packageUri: Uri | null) : Promise<string[]> {

        let folderPath: string = ''
        if (packageUri) {
            folderPath = packageUri.fsPath
        }

        try {
            const cmd = 'elan';
            const options = ['toolchain', 'list'];
            const stdout = await batchExecute(cmd, options, folderPath, undefined);
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
            return [`${err}`];
        }
    }

    async hasElan() : Promise<boolean> {
        let elanInstalled = false;
        // See if we have elan already.
        try {
            const options = ['--version']
            const stdout = await this.executeWithProgress('Checking Elan setup...', 'elan', options, null)
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

            if (process.platform === 'win32') {
                terminal.sendText(
                    `Invoke-WebRequest -Uri "${this.leanInstallerWindows}" -OutFile elan-init.ps1\n` +
                    `.\\elan-init.ps1 -NoMenu 1 -PromptOnError 1 -DefaultToolchain ${this.defaultToolchain}\n` +
                    'del .\\elan-init.ps1\n' +
                    'exit\n'
                    );
            }
            else{
                const elanArgs = `-y --default-toolchain ${this.defaultToolchain}`;
                const prompt = 'echo && read -n 1 -s -r -p "Install failed, press ENTER to continue..."';

                terminal.sendText(`bash -c 'curl ${this.leanInstallerLinux} -sSf | sh -s -- ${elanArgs} || ${prompt}' && exit `);
            }

            return result;
        }
    }

    dispose(): void {
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
