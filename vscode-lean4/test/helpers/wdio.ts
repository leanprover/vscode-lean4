/// <reference types="wdio-vscode-service" />
import { browser } from '@wdio/globals'
import { FIRST_DIAGS_TIMEOUT_MS } from './timeouts'

// Load-bearing for `findInfoView` below: the InfoView's webview HTML sets
// `<title>InfoView</title>` (see `vscode-lean4/src/infoview.ts`). If that
// title is ever renamed, change this constant in lockstep.
const INFOVIEW_TITLE = 'InfoView'

// Walks every webview the workbench currently holds and returns the one whose
// document title identifies it as the InfoView. The caller owns the open
// webview frame and must `close()` it before doing anything that needs the
// VS Code (non-frame) context. Throws if no InfoView frame is present.
//
// We read the title via `$('title').getHTML(false)` rather than
// `browser.getTitle()` because the WebDriver `Get Title` command returns the
// *top-level* browsing context's title — i.e. the outer VS Code window —
// regardless of any `switchToFrame` we've done. Querying the `<title>`
// element via the DOM honours the current frame.
async function findInfoView(): Promise<{ close: () => Promise<void> }> {
    const workbench = await browser.getWorkbench()
    for (const view of await workbench.getAllWebviews()) {
        await view.open()
        const title = (await browser.$('title').getHTML(false)).trim()
        if (title === INFOVIEW_TITLE) {
            return { close: () => view.close() }
        }
        await view.close()
    }
    throw new Error(
        `InfoView webview not found (no webview reported a document title of ${JSON.stringify(INFOVIEW_TITLE)})`,
    )
}

// Opens `fileName` from the workspace folder in editor group one. Forces the
// first group because, if the InfoView webview is focused, VS Code would
// otherwise open the document as a tab inside that group.
export async function openFixtureFile(fileName: string): Promise<void> {
    await browser.executeWorkbench(
        async (vscode, fileName: string) => {
            const [folder] = vscode.workspace.workspaceFolders ?? []
            const uri = vscode.Uri.joinPath(folder.uri, fileName)
            const doc = await vscode.workspace.openTextDocument(uri)
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One })
        },
        fileName,
    )
}

// `line` and `column` are zero-indexed.
export async function moveCursorTo(line: number, column: number): Promise<void> {
    await browser.executeWorkbench(
        async (vscode, line: number, column: number) => {
            const editor = vscode.window.activeTextEditor
            if (!editor) throw new Error('no active editor')
            const pos = new vscode.Position(line, column)
            editor.selection = new vscode.Selection(pos, pos)
            editor.revealRange(new vscode.Range(pos, pos))
        },
        line,
        column,
    )
}

export async function runCommand(id: string): Promise<void> {
    await browser.executeWorkbench(async (vscode, id: string) => {
        await vscode.commands.executeCommand(id)
    }, id)
}

// Polls the InfoView WebView for body text matching `predicate`. Generous
// default timeout covers first-run toolchain install — the InfoView's content
// is gated on the Lean server publishing goals, so its budget can't
// realistically exceed `FIRST_DIAGS_TIMEOUT_MS`; reuse the constant so the
// two move together when CDN/latency assumptions shift. A timeout signals
// that the content never arrived, not that we couldn't find the InfoView —
// the frame is identified by `document.title`, not by content matching.
export async function waitForInfoView(
    predicate: (text: string) => boolean,
    { label, timeout = FIRST_DIAGS_TIMEOUT_MS }: { label: string; timeout?: number },
): Promise<void> {
    await browser.waitUntil(
        async () => {
            let close: (() => Promise<void>) | undefined
            try {
                ;({ close } = await findInfoView())
                return predicate(await browser.$('body').getText())
            } catch {
                // InfoView not yet present, or transient frame-switch error;
                // keep polling until the deadline.
                return false
            } finally {
                if (close) await close()
            }
        },
        { timeout, interval: 1000, timeoutMsg: `timed out waiting for InfoView: ${label}` },
    )
}

// Reports whether any tab in any tab group currently holds a VS Code webview
// whose viewType identifies it as the Lean4 InfoView. The extension creates
// the panel with `createWebviewPanel('lean4_infoview', …)`; VS Code exposes
// that via `TabInputWebview.viewType`, usually prefixed by
// `mainThreadWebview-`, so substring-match for robustness.
//
// Narrow via `instanceof vscode.TabInputWebview` rather than indexing
// `tab.input` through `as any`: the discriminator preserves type info for
// `viewType` (catches a typo in the property name) and prunes tab kinds
// that can't carry a webview (`TabInputText`, `TabInputTerminal`, etc.).
//
// Uses VS Code's tab API rather than scraping webview body text: the tab API
// gives a definitive present/absent answer, where DOM scraping can't tell
// "the InfoView tab is gone" from "the InfoView tab is still there but its
// body hasn't rendered yet" — and can be confused by unrelated webviews
// (welcome page, release notes, etc.) whose content happens to match.
export async function isInfoViewOpen(): Promise<boolean> {
    return browser.executeWorkbench(async vscode => {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes('lean4_infoview')) {
                    return true
                }
            }
        }
        return false
    })
}

// Opens the InfoView webview frame, runs `fn` inside it, and returns
// whatever `fn` returns. The frame is identified by `document.title`, so
// unrelated webviews (welcome page, release notes, etc.) are never
// considered. Throws if the InfoView is not currently open — call
// `waitForInfoView` first if the InfoView may still be coming up.
export async function withInfoView<T>(fn: () => Promise<T>): Promise<T> {
    const { close } = await findInfoView()
    try {
        return await fn()
    } finally {
        await close()
        // Clicking inside the WebView shifts focus to the InfoView panel.
        // `view.close()` returns the iframe context to the workbench but
        // doesn't restore focus to the editor group, so a follow-up
        // `vscode.window.activeTextEditor` would come back undefined and
        // helpers like `moveCursorTo` would throw "no active editor".
        await browser.executeWorkbench(async vscode => {
            await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup')
        })
    }
}
