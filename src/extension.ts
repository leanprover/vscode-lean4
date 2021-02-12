import { workspace, commands, window, languages, ExtensionContext, TextDocument } from 'vscode'
import { promisify } from 'util'
import { exec } from 'child_process'
import { AbbreviationFeature } from './abbreviation'
import { executablePath } from './config'
import { LeanClient } from './leanclient'
import { InfoView } from './infoview'

async function checkLean4(): Promise<boolean> {
    const folders = workspace.workspaceFolders
    let folderPath: string
    if (folders) {
        folderPath = folders[0].uri.fsPath
    }
    const cmd = `${executablePath()} --version`
    try {
        // If folderPath is undefined, this will use the process environment for cwd.
        // Specifically, if the extension was not opened inside of a folder, it
        // looks for a global (default) installation of Lean. This way, we can support
        // single file editing.
        const { stdout, stderr } = await promisify(exec)(cmd, {cwd: folderPath})
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

const client: LeanClient = new LeanClient()
let infoView: InfoView

export async function activate(context: ExtensionContext): Promise<any> {
    const isLean4Project = await checkLean4()
    // API provided to vscode-lean. If isLean4Project is true, (i.e. vscode-lean4 is being activated),
    // vscode-lean will not activate.
    const api = { isLean4Project }
    if (!isLean4Project) {
        return api
    }

    // All open .lean files of this workspace are assumed to be Lean 4 files.
    // We need to do this because by default, .lean is associated with language id `lean`,
    // i.e. Lean 3. vscode-lean is expected to yield when isLean4 is true.
    const setLean4LanguageId = async (textDocument: TextDocument) => {
        if (textDocument.languageId === 'lean') {
            await languages.setTextDocumentLanguage(textDocument, 'lean4')
        }
    }
    for (const textDocument of workspace.textDocuments) {
        await setLean4LanguageId(textDocument)
    }
    workspace.onDidOpenTextDocument(setLean4LanguageId)

    // Register support for unicode input
    context.subscriptions.push(new AbbreviationFeature())

    infoView = new InfoView(context)

    // NOTE(Marc): This runs quite rarely, but I hope that it's good enough for now.
    // I tried using languages.onDidChangeDiagnostics, which yields `language client not ready yet` errors.
    // Maybe this is fixed for a newer version of the LSP client, I don't know.
    window.onDidChangeTextEditorSelection(async e => {
        if (!e.selections) {
            infoView.wipeGoalsIfOpen()
            return
        }
        const response: any = await client.requestPlainGoals(e.textEditor.document, e.selections[0].active) as Promise<any>
        if (!response) {
            infoView.wipeGoalsIfOpen()
            return
        }
        infoView.displayGoals(response.rendered)
    })

    context.subscriptions.push(commands.registerCommand('lean4.plainInfoView.toggleAutoUpdate', () => {
        infoView.toggleAutoUpdate()
    }))
    context.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
        if (!window.activeTextEditor) { return }
        client.refreshFileDependencies(window.activeTextEditor)
    }))
    context.subscriptions.push(commands.registerCommand('lean4.restartServer', () => client.restart()));

    void client.start()
    return api
}

export function deactivate(): Thenable<void> | undefined {
    if (!client.isStarted()) {
        return undefined
    }
    return client.stop()
}
