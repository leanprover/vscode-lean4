import { NotebookCellOutput, OutputChannel } from 'vscode'
import { spawn } from 'child_process';

export async function batchExecute(
    executablePath: string,
    args: any[],
    workingDirectory: string,
    channel: OutputChannel): Promise<string> {

    return new Promise(function(resolve, reject){
        let output : string = '';
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }
        const exe = spawn(executablePath, args, options);

        if (exe.pid === undefined) {
            resolve(undefined);
        }

        exe.stdout.on('data', (line) => {
            const s = line.toString();
            if (channel) channel.appendLine(s);
            output += s + '\n';
        });

        exe.stderr.on('data', (line) => {
            const s = line.toString();
            if (channel) channel.appendLine(s);
            output += s + '\n';
        });

        exe.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            resolve(output)
        });

    });

}
