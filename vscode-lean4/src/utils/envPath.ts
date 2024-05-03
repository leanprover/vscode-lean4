import * as path from 'path'

/** Platform independent interface to work with the PATH variable. */
export class PATH {
    paths: string[]

    constructor(paths: string[]) {
        this.paths = paths
    }

    static empty() {
        return new PATH([])
    }

    static ofEnvPath(envPath: string): PATH {
        return new PATH(envPath.split(path.delimiter))
    }

    static ofEnv(env: NodeJS.ProcessEnv): PATH {
        return PATH.ofEnvPath(env.PATH ?? '')
    }

    static ofProcessEnv(): PATH {
        return PATH.ofEnv(process.env)
    }

    toEnvPath(): string {
        return this.paths.join(path.delimiter)
    }

    setInEnv(env: NodeJS.ProcessEnv) {
        env.PATH = this.toEnvPath()
    }

    setInProcessEnv() {
        this.setInEnv(process.env)
    }

    prepend(path: string): PATH {
        return new PATH([path].concat(this.paths))
    }

    join(other: PATH): PATH {
        return new PATH(this.paths.concat(other.paths))
    }

    length(): number {
        return this.paths.length
    }

    isEmpty(): boolean {
        return this.length() === 0
    }

    includes(path: string): boolean {
        return this.paths.includes(path)
    }

    filter(p: (path: string) => boolean): PATH {
        return new PATH(this.paths.filter(p))
    }
}

export function setPATH(env: NodeJS.ProcessEnv, path: PATH) {
    path.setInEnv(env)
}

export function setProcessEnvPATH(path: PATH) {
    setPATH(process.env, path)
}
