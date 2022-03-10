import { OutputChannel, ProcessExecution } from 'vscode'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export async function batchExecute(
    executablePath: string,
    args: any[],
    workingDirectory: string | null,
    channel: OutputChannel | undefined): Promise<string | undefined> {

    return new Promise(function(resolve, reject){
        let output : string = '';
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }
        try {
            const exe = spawn(executablePath, args, options);

            if (exe.pid === undefined) {
                resolve(undefined);
            }

            exe.stdout.on('data', (line) => {
                const s: string = line.toString();
                if (channel) channel.appendLine(s);
                output += s + '\n';
            });

            exe.stderr.on('data', (line) => {
                const s: string = line.toString();
                if (channel) channel.appendLine(s);
                output += s + '\n';
            });

            exe.on('close', (code) => {
                console.log(`child process exited with code ${code}`);
                resolve(output)
            });

        } catch (e){
            console.log(`error running ${executablePath} : ${e}`);
            resolve(undefined);
        }
    });
}
