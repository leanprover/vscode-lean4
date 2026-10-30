import { TextDocument, TextEditor, Uri, ViewColumn, commands, window, workspace } from 'vscode'

// Closes all editors. `afterEachReset` calls it after each test.
export async function closeAllEditors(): Promise<void> {
    await commands.executeCommand('workbench.action.closeAllEditors')
}

// Opens `uri` in the first editor group. Without `ViewColumn.One`, the file
// opens in the column of the InfoView when the InfoView has the focus.
export async function openInEditor(uri: Uri): Promise<TextEditor> {
    return showInEditor(await workspace.openTextDocument(uri))
}

// Shows `doc` in the first editor group, for example an untitled document.
export async function showInEditor(doc: TextDocument): Promise<TextEditor> {
    return window.showTextDocument(doc, { viewColumn: ViewColumn.One })
}
