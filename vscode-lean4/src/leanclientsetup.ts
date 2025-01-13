import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { serverArgs, serverLoggingEnabled, serverLoggingPath } from './config'
import { ExtUri } from './utils/exturi'
import { willUseLakeServer } from './utils/projectInfo'
import { c2pConverter, p2cConverter, patchConverters, setDependencyBuildMode } from './utils/converters'

async function determineExecutable(folderUri: ExtUri): Promise<[string, string[]]> {
    if (await willUseLakeServer(folderUri)) {
        return ['lake', ['serve', '--']]
    } else {
        return ['lean', ['--server']]
    }
}

async function determineServerOptions(toolchainOverride: string | undefined, folderUri: ExtUri): Promise<ServerOptions> {
    const env = Object.assign({}, process.env)
    if (serverLoggingEnabled()) {
        env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
    }

    const [serverExecutable, options] = await determineExecutable(folderUri)
    if (toolchainOverride) {
        options.unshift('+' + toolchainOverride)
    }

    const cwd = this.folderUri.scheme === 'file' ? this.folderUri.fsPath : undefined
    if (cwd) {
        // Add folder name to command-line so that it shows up in `ps aux`.
        options.push(cwd)
    } else {
        options.push('untitled')
    }

    return {
        command: serverExecutable,
        args: options.concat(serverArgs()),
        options: {
            cwd,
            env,
        },
    }
}

export async function setupClient(
    toolchainOverride: string | undefined,
    clientOptions: LanguageClientOptions,
    folderUri: ExtUri,
): Promise<LanguageClient> {
    const serverOptions: ServerOptions = await this.determineServerOptions(toolchainOverride, folderUri)

    const client = new LanguageClient('lean4', 'Lean 4', serverOptions, clientOptions)

    patchConverters(client.protocol2CodeConverter, client.code2ProtocolConverter)
    return client
}
