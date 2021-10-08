import { window, workspace, TerminalOptions, OutputChannel } from 'vscode'
import { executablePath, addServerEnvPaths } from '../config'
import { batchExecute } from './batch'

export class LeanInstaller {

    private leanInstallerLinux = 'https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh'
    private leanInstallerWindows = 'https://github.com/lovettchris/elan/raw/clovett/windows/elan-init.ps1'
    private defaultLeanVersion = 'leanprover/lean4:nightly'
    private outputChannel: OutputChannel;

    constructor(outputChannel: OutputChannel){
        this.outputChannel = outputChannel;
    }

    async checkLean4(cmd : string): Promise<boolean> {
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
            // const { stdout, stderr } = await promisify(execFile)(cmd, options, {cwd: folderPath, env })
            const filterVersion = /version (\d+)\.\d+\..+/
            const match = filterVersion.exec(stdout)
            if (!match) {
                void window.showErrorMessage(`lean4: '${cmd} ${options}' returned incorrect version string '${stdout}'.`)
                return false
            }
            const major = match[1]
            if (major !== '4') {
                return false
            }
            return true
        } catch (err) {
            void window.showErrorMessage(`lean4: Could not find Lean version by running '${cmd} ${options}'.`)
            this.outputChannel.appendLine(err);
            return false
        }
    }

    async installLean() : Promise<boolean> {

        if (executablePath() !== 'lean') {
            this.outputChannel.appendLine('It looks like you\'ve modified the `lean.executablePath` user setting.');
            this.outputChannel.appendLine('Please change it back to a \'lean\' before installing elan.');
            return false;
        } else {
            const terminalName = 'Lean installation via elan';
            let terminalOptions: TerminalOptions = { name: terminalName };
            if (process.platform === 'win32') {
                const windir = process.env.windir
                terminalOptions = { name: terminalName, shellPath: `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` };
            }
            const terminal = window.createTerminal(terminalOptions);

            // We register a listener, to restart the Lean extension once elan has finished.
            const result = new Promise<boolean>(function(resolve, reject) {
                window.onDidCloseTerminal((t) => {
                if (t.name === terminalName) {
                    resolve(true);
                }});
            });

            // Now show the terminal and run elan.
            terminal.show();
            if (process.platform === 'win32') {
                terminal.sendText(
                    `Invoke-WebRequest -Uri "${this.leanInstallerWindows}" -OutFile elan-init.ps1; ` +
                    `.\\elan-init.ps1 --default-toolchain "${this.defaultLeanVersion}" ; ` +
                    'del elan-init.ps1 ; Read-Host -Prompt "Press ENTER key to start Lean" ; exit\n');
            }
            else{
                terminal.sendText(
                    `curl ${this.leanInstallerLinux} -sSf | sh -s -- --default-toolchain ${this.defaultLeanVersion} && ` +
                    'echo && read -n 1 -s -r -p "Press any key to start Lean" && exit\n');
            }

            return result;
        }
    }
}
