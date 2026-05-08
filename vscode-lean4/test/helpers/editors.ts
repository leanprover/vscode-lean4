import { TextDocument, TextEditor, Uri, ViewColumn, commands, window, workspace } from 'vscode'

// Suites that open editors should call this in `afterEach` so each test
// starts from a known "no editor open" state.
export async function closeAllEditors(): Promise<void> {
    await commands.executeCommand('workbench.action.closeAllEditors')
}

// Opens `uri` and shows it in the primary editor group. Always pins to
// `ViewColumn.One` so opened docs don't drift into the InfoView's column
// once the webview is focused (see `feedback_showTextDocument_viewColumn`).
export async function openInEditor(uri: Uri): Promise<TextEditor> {
    return showInEditor(await workspace.openTextDocument(uri))
}

// Shows an already-opened `TextDocument` in the primary editor group with
// the same column-pinning as `openInEditor`. Use this for untitled / in-memory
// documents constructed via `workspace.openTextDocument({ … })`.
export async function showInEditor(doc: TextDocument): Promise<TextEditor> {
    return window.showTextDocument(doc, { viewColumn: ViewColumn.One })
}
