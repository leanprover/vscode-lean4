import { OutputChannel } from 'vscode'
import { spawn } from 'child_process';

export async function batchExecute(
    toolchainPath: string,
    args: any[],
    workingDirectory: string,
    channel: OutputChannel): Promise<string> {

    return new Promise(function(resolve, reject){
        let output : string = '';
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }
        const exe = spawn(toolchainPath, args, options);

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

    });

}

export async function testExecute(
    toolchainPath: string,
    args: any[],
    workingDirectory: string,
    delay: number = 1000): Promise<number> {

    return new Promise(function(resolve, reject){
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }
        const exe = spawn(toolchainPath, args, options);

        if (exe.pid === undefined) {
            resolve(-1);
        }

        exe.stdout.on('data', (line) => {
            const s: string = line.toString();
            console.log(s);
        });

        exe.stderr.on('data', (line) => {
            const s: string = line.toString();
            console.log(s);
        });

        let resolved = false
        exe.on('close', (code) => {
            if (!resolved) {
                resolved = true
                resolve(code)
            }
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (exe.exitCode !== null) {
                    resolve(exe.exitCode)
                } else {
                    // it is running!
                    exe.kill()
                    resolve(0)
                }
            }
        }, delay);

    });

}
