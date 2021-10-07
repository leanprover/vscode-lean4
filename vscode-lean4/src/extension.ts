import { workspace, commands, window, languages, ExtensionContext } from 'vscode'
import { AbbreviationFeature } from './abbreviation'
import { LeanClient } from './leanclient'
import { InfoProvider } from './infoview'
import { LeanTaskGutter } from './taskgutter'
import { LocalStorageService} from './utils/localStorage'

export async function activate(context: ExtensionContext): Promise<any> {
    const api = { isLean4Project: true }

    await Promise.all(workspace.textDocuments.map(async (doc) =>
        doc.languageId === 'lean' && languages.setTextDocumentLanguage(doc, 'lean4')))

    const storageManager = new LocalStorageService(context.workspaceState);

    const client: LeanClient = new LeanClient(storageManager)
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

    context.subscriptions.push(commands.registerCommand('lean4.selectInterpreter', () => client.selectInterpreter()));

    void client.start()
    return api
}
