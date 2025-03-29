import { commands, Disposable, Uri, window } from 'vscode'

export class UriHandlerService implements Disposable {
    private subscriptions: Disposable[] = []

    constructor() {
        this.registerUriHandler()
    }

    dispose(): void {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }

    private registerUriHandler() {
        this.subscriptions.push(
            window.registerUriHandler({
                async handleUri(uri: Uri) {
                    if (uri.path === '/setup-guide') {
                        await commands.executeCommand('lean4.docs.showSetupGuide')
                    }
                },
            }),
        )
    }
}
