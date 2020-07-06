import express = require('express');
import { ExtensionContext, Disposable, workspace } from 'vscode';
import { Server, createServer } from 'http';
import { normalize } from 'path';

// workaround for https://github.com/microsoft/vscode/issues/89038
// avoid vscode-resource:, let's just run our own http server...
export class StaticServer implements Disposable {
    private app: express.Express;
    private key: string;
    server: Server;

    constructor(private context: ExtensionContext) {
        this.app = express();
        this.key = Math.random().toString(36).substring(2);
        this.app.get(`/${this.key}/*`, (req, res) => {
            const fileName = req.params[0];
            if (this.isAllowedFilePath(fileName)) {
                res.sendFile(fileName);
            } else {
                res.sendStatus(403);
            }
        });
        this.server = createServer(this.app);
        this.server.listen(null, '127.0.0.1');
    }

    port(): number {
        return (this.server.address() as any).port;
    }

    private isAllowedFilePath(fileName: string): boolean {
        fileName = normalize(fileName);
        if (fileName.startsWith(this.context.extensionPath)) {
            return true;
        }
        for (const folder of workspace.workspaceFolders) {
            if (fileName.startsWith(folder.uri.fsPath)) {
                return true;
            }
        }
        return false;
    }

    mkUri(fileName: string): string {
        return `http://127.0.0.1:${this.port()}/${this.key}/${encodeURI(fileName)}`;
    }

    dispose(): void {
        this.server.close();
    }
}