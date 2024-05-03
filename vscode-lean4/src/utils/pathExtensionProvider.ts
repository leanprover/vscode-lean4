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
        )
    }

    static withAddedEnvPathExtensions(): PathExtensionProvider {
        return new PathExtensionProvider()
    }

    replaceEnvPathExtensionsInPATH() {
        const previousPathExtensions = this.currentPathExtensions
        this.currentPathExtensions = envPathExtensions()
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
