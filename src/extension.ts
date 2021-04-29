import { workspace, commands, window, languages, ExtensionContext, TextDocument } from 'vscode'
import { promisify } from 'util'
import { exec } from 'child_process'
import { AbbreviationFeature } from './abbreviation'
import { executablePath, addServerEnvPaths } from './config'
import { LeanClient } from './leanclient'
import { InfoProvider } from './infoview'
import { LeanTaskGutter } from './taskgutter'
import * as path from 'path'

async function checkLean4(): Promise<boolean> {
    const folders = workspace.workspaceFolders
    let folderPath: string
    if (folders) {
        folderPath = folders[0].uri.fsPath
    }
    
    const env = addServerEnvPaths(process.env);
    const cmd = `${executablePath()} --version`
    try {
        // If folderPath is undefined, this will use the process environment for cwd.
        // Specifically, if the extension was not opened inside of a folder, it
        // looks for a global (default) installation of Lean. This way, we can support
        // single file editing.
        const { stdout, stderr } = await promisify(exec)(cmd, {cwd: folderPath, env: env })
        const filterVersion = /version (\d+)\.\d+\..+/
        const match = filterVersion.exec(stdout)
        if (!match) {
            void window.showErrorMessage(`lean4: '${cmd}' returned incorrect version string '${stdout}'.`)
            return false
        }
        const major = match[1]
        if (major !== '4') {
            return false
        }
        return true
    } catch (err) {
        void window.showErrorMessage(`lean4: Could not find Lean version by running '${cmd}'.`)
        return false
    }
}

export async function activate(context: ExtensionContext): Promise<any> {
    const isLean4Project = await checkLean4()
    // API provided to vscode-lean. If isLean4Project is true, (i.e. vscode-lean4 is being activated),
    // vscode-lean will not activate.
    const api = { isLean4Project }
    if (!isLean4Project) {
        return api
    }

    await Promise.all(workspace.textDocuments.map(async (doc) =>
        doc.languageId === 'lean' && languages.setTextDocumentLanguage(doc, 'lean4')))

    const client: LeanClient = new LeanClient()
    context.subscriptions.push(client)

    // Register support for unicode input
    context.subscriptions.push(new AbbreviationFeature())

    context.subscriptions.push(new InfoProvider(client, {language: 'lean4'}, context))

    context.subscriptions.push(new LeanTaskGutter(client, context))

    context.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
        if (!window.activeTextEditor) { return }
        client.refreshFileDependencies(window.activeTextEditor)
    }))
    context.subscriptions.push(commands.registerCommand('lean4.restartServer', () => client.restart()));

    void client.start()
    return api
}
