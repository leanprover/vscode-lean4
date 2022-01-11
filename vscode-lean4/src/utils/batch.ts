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
    channel: OutputChannel,
    closeStdInput: boolean,
    expectedError: string,
    timeout = 10000): Promise<number> {

    return new Promise(function(resolve, reject){
        let options = {}
        if (workingDirectory !== undefined) {
            options = { cwd: workingDirectory };
        }
        const msg = `Testing '${toolchainPath} ${args.join(' ')}'`
        if (channel) channel.appendLine(msg);
        console.log(msg)

        let foundExpectedError = false;
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
            // no need to print the stream closed error.
            if (expectedError === s) {
                foundExpectedError = true;
            }
            else {
                if (channel) channel.appendLine(s);
                console.log(s);
            }
        });

        if (closeStdInput){
            exe.stdin.end();
        }

        let resolved = false
        exe.on('close', (code) => {
            if (!resolved) {
                resolved = true
                if (foundExpectedError) {
                    code = 0;
                }
                resolve(code)
            }
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                let code = exe.exitCode;
                if (code !== null){
                    if (foundExpectedError) {
                        code = 0;
                    }
                    resolve(code)
                }
                else {
                    // it is running!
                    exe.kill()
                    resolve(0)
                }
            }
        }, timeout);

    });

}
