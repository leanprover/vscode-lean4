import { OutputChannel } from 'vscode'
import { spawn } from 'child_process';
import { findProgramInPath, isRunningTest } from '../config'
import { logger } from './logger'

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
            if (isRunningTest())
            {
                // The mocha test framework listens to process.on('uncaughtException')
                // which is raised if spawn cannot find the command and the test automatically
                // fails with "Uncaught Error: spawn elan ENOENT".  Therefore we manually
                // check if the command exists so as not to trigger that exception.
                const fullPath = findProgramInPath(executablePath);
                if (!fullPath) {
                    resolve(undefined);
                    return;
                }
            }
            const proc = spawn(executablePath, args, options);

            if (proc.pid === undefined) {
                resolve(undefined);
                return;
            }

            proc.stdout.on('data', (line) => {
                const s: string = line.toString();
                if (channel) channel.appendLine(s);
                output += s + '\n';
            });

            proc.stderr.on('data', (line) => {
                const s: string = line.toString();
                if (channel) channel.appendLine(s);
                output += s + '\n';
            });

            proc.on('close', (code) => {
                logger.log(`child process exited with code ${code}`);
                resolve(output)
            });

        } catch (e){
            logger.log(`error running ${executablePath} : ${e}`);
            resolve(undefined);
        }
    });
}
