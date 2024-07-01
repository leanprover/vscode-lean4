import {
    serverArgs,
    serverLoggingEnabled,
    serverLoggingPath,
} from './config'
import {
    LanguageClient,
    LanguageClientOptions,
} from 'vscode-languageclient/node'
import { willUseLakeServer } from './utils/projectInfo'
import { ExtUri } from './utils/exturi'

export async function setupClient(clientOptions: LanguageClientOptions, folderUri: ExtUri, elanDefaultToolchain: string) {

    const env = Object.assign({}, process.env)
    if (serverLoggingEnabled()) {
        env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
    }

    let serverExecutable, options; 
    if (await willUseLakeServer(folderUri)) {
        [serverExecutable, options] = ['lake', ['serve', '--']]
    } else {
        [serverExecutable, options] = ['lean', ['--server']]
    }

    const cwd = folderUri.scheme === 'file' ? folderUri.fsPath : undefined
    if (cwd) {
        // Add folder name to command-line so that it shows up in `ps aux`.
        options.push(cwd)
    } else {
        // Fixes issue #227, for adhoc files it would pick up the cwd from the open folder
        // which is not what we want.  For adhoc files we want the (default) toolchain instead.
        options.unshift('+' + elanDefaultToolchain)
        options.push('untitled')
    }

    const serverOptions = {
        command: serverExecutable,
        args: options.concat(serverArgs()),
        options: {
            cwd,
            env,
        },
    }

    return new LanguageClient('lean4', 'Lean 4', serverOptions, clientOptions)
}