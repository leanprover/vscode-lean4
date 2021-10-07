import { NotebookCellOutput, OutputChannel } from 'vscode'
import { spawn } from 'child_process';

export async function batchExecute(
    executablePath: string,
    args: any[],
    workingDirectory: string,
    channel: OutputChannel): Promise<string> {

    return new Promise(function(resolve, reject){
        let output : string = '';

        const exe = spawn(executablePath, args, { cwd: workingDirectory });

        if (exe.pid === undefined) {
            resolve('program not found');
        }

        exe.stdout.on('data', (line) => {
            const s = line.toString();
            channel.appendLine(s);
            output += s + '\n';
        });

        exe.stderr.on('data', (line) => {
            const s = line.toString();
            channel.appendLine(s);
            output += s + '\n';
        });

        exe.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            resolve(output)
        });

    });

}
