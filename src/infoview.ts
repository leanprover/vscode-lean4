import { readFileSync } from 'fs';
import { join } from 'path';
import { ExtensionContext, ViewColumn, WebviewPanel, window, workspace } from 'vscode';

export class InfoView {
    private view: WebviewPanel
    private stylesheet: String
    private updateAutomatically: boolean = true

    private isClosed(): boolean {
        return !this.view
    }

    private openViewIfClosed(): void {
        if (!this.isClosed()) {
            return
        }
        this.view = window.createWebviewPanel('lean4', 'Lean InfoView',
        {
            viewColumn: ViewColumn.Beside,
            preserveFocus: true
        },
        {
            enableFindWidget: true,
            retainContextWhenHidden: true,
            enableCommandUris: true
        })
        this.view.onDidDispose(() => this.view = undefined)
    }

    constructor(context: ExtensionContext) {
        this.openViewIfClosed()
        const css = context.asAbsolutePath(join('media', 'infoview.css'));
        const familyConfig: string = workspace.getConfiguration('editor').get('fontFamily')
        const fontFamily = familyConfig.replace(/['"]/g, '');
        this.stylesheet = readFileSync(css, 'utf-8') + `
            pre {
                font-family: ${fontFamily};
                font-size: ${workspace.getConfiguration('editor').get('fontSize')}px;
                white-space: pre-wrap;
            }`
    }

    // https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
    private escapeHtml(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
    }

    private emphasizeMessage(goal: string): string {
        return goal
            .replace(/([^`~@$%^&*()-=+\[{\]}⟨⟩⦃⦄⟦⟧⟮⟯‹›\\|;:",.\/\s]+)✝([¹²³⁴-⁹⁰]*)/g, '<span class="goal-inaccessible">$1$2</span>')
            .replace(/^(⊢) /mg, '<strong class="goal-vdash">$1</strong> ')
            .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
            .replace(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg, '<strong class="goal-hyp">$1</strong> :')
    }

    private updateGoalView(goal : String): void {
        if (!this.updateAutomatically) {
            return
        }
        this.view.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>InfoView</title>
                <style>${this.stylesheet}</style>
            </head>
            <body>
                <pre>${goal}</pre>
            </body>
            </html>`
    }

    displayGoals(unformatted: string): void {
        this.openViewIfClosed()
        const r = /```lean\n([^`]*)```/g
        const goals: string[] = []
        let match: RegExpExecArray
        do {
            match = r.exec(unformatted)
            if (match) {
                goals.push(match[1])
            }
        } while (match)
        if (goals.length === 0) {
            this.updateGoalView('Goals accomplished!')
            return
        }
        this.updateGoalView(this.emphasizeMessage(this.escapeHtml(goals.join('\n'))))
    }

    wipeGoalsIfOpen(): void {
        if (this.isClosed()) {
            return
        }
        this.updateGoalView('Click on a tactic in a tactic proof to display the goal state after execution of the tactic.')
    }

    toggleAutoUpdate(): void {
        this.updateAutomatically = !this.updateAutomatically
    }
}