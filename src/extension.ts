import { workspace, commands, window, languages, ExtensionContext, TextDocument } from 'vscode'
import { promisify } from 'util'
import { exec } from 'child_process'
import { AbbreviationFeature } from './abbreviation'
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from 'vscode-languageclient'

function executablePath(): string {
    return workspace.getConfiguration('lean').get('lean.executablePath', 'lean')
}

function serverLoggingEnabled(): boolean {
    return workspace.getConfiguration('lean4.serverLogging').get('enabled', false)
}

function serverLoggingPath(): string {
    return workspace.getConfiguration('lean4.serverLogging').get('path', '.')
}

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
        const filterVersion = /Lean \(version (\d+)\.(\d+)\.([^,]+), commit [^,]+, \w+\)/
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

let client: LanguageClient

function restartServer(): void {
    if (client) {
        void client.stop()
        client = undefined
    }
    const serverOptions: ServerOptions = {
        command: executablePath(),
        args: ['--server'],
        options: {
            shell: true,
            env: { ...process.env }
        }
    }
    if (serverLoggingEnabled()) {
        serverOptions.options.env.LEAN_SERVER_LOG_DIR = serverLoggingPath()
    }
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'lean4' }]
    }
    client = new LanguageClient(
        'lean4',
        'Lean 4',
        serverOptions,
        clientOptions
    )
    client.start()
}

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
    const setLean4LanguageId = (textDocument: TextDocument) => {
        if (textDocument.languageId === 'lean') {
            void languages.setTextDocumentLanguage(textDocument, 'lean4')
        }
    }
    for (const textDocument of workspace.textDocuments) {
        setLean4LanguageId(textDocument)
    }
    workspace.onDidOpenTextDocument(setLean4LanguageId)

    // Register support for unicode input
    context.subscriptions.push(new AbbreviationFeature());

    context.subscriptions.push(commands.registerCommand('lean4.refreshFileDependencies', () => {
        const editor = window.activeTextEditor
        if (!editor) { return }
        const doc = editor.document
        const uri = doc.uri.toString()
        // This causes a text document version number discontinuity. In
        // (didChange (oldVersion) => refreshFileDependencies => didChange (newVersion))
        // the client emits newVersion = oldVersion + 1, despite the fact that the
        // didOpen packet emitted below initializes the version number to be 1.
        // This is not a problem though, since both client and server are fine
        // as long as the version numbers are monotonous.
        client.sendNotification('textDocument/didClose', {
            'textDocument': {
                uri
            }
        })
        client.sendNotification('textDocument/didOpen', {
            'textDocument': {
                uri,
                'languageId': 'lean4',
                'version': 1,
                'text': doc.getText()
            }
        })
    }))

    context.subscriptions.push(commands.registerCommand('lean4.restartServer', restartServer));

    restartServer()
    return api
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined
    }
    return client.stop()
}
