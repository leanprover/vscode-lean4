import * as nodePath from 'path'
import { Disposable, workspace } from 'vscode'
import { envPathExtensions } from '../config'
import { PATH, setProcessEnvPATH } from './envPath'

export class PathExtensionProvider implements Disposable {
    currentPathExtensions: PATH = PATH.empty()
    subscriptions: Disposable[] = []

    private constructor() {
        this.replaceEnvPathExtensionsInPATH()
        this.subscriptions.push(
            workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('lean4.envPathExtensions')) {
                    this.replaceEnvPathExtensionsInPATH()
                }
            }),
            workspace.onDidChangeWorkspaceFolders(_ => {
                this.replaceEnvPathExtensionsInPATH()
            }),
        )
    }

    static withAddedEnvPathExtensions(): PathExtensionProvider {
        return new PathExtensionProvider()
    }

    replaceEnvPathExtensionsInPATH() {
        const previousPathExtensions = this.currentPathExtensions
        const exts = envPathExtensions()
        const resolvedPaths: string[] = []
        for (const p of exts.paths) {
            if (nodePath.isAbsolute(p)) {
                resolvedPaths.push(p)
                continue
            }
            for (const folder of workspace.workspaceFolders ?? []) {
                resolvedPaths.push(nodePath.resolve(folder.uri.fsPath, p))
            }
        }
        this.currentPathExtensions = new PATH(resolvedPaths)
        const path = PATH.ofProcessEnv()
        const originalPath = path.filter(path => !previousPathExtensions.includes(path))
        setProcessEnvPATH(this.currentPathExtensions.join(originalPath))
    }

    dispose() {
        for (const s of this.subscriptions) {
            s.dispose()
        }
    }
}
