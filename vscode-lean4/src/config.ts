import { workspace } from 'vscode'
import * as path from 'path';
import * as fs from 'fs'

// TODO: does currently not contain config options for `./abbreviation`
// so that it is easy to keep it in sync with vscode-lean.

export function getEnvPath() : string {
    if (process.platform === 'win32') {
        return process.env.Path ?? ''
    } else {
        return process.env.PATH ?? ''
    }
}

export function setEnvPath(value : string) : void {
    if (process.platform === 'win32') {
        process.env.Path = value
    } else {
        process.env.PATH = value
    }
}

function splitEnvPath(value: string) : string[] {
    return value.split(path.delimiter)
}

function joinEnvPath(value: string[]) : string {
    return value.join(path.delimiter)
}

// Make a copy of the passed process environment that includes the user's
// `lean4.serverEnvPaths` in the path key, and adds the key/value pairs from
// `lean4.serverEnv`. Both of these settings can be found in the user's
// settings.json file
export function addServerEnvPaths(input_env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = Object.assign({}, input_env, serverEnv());
    const paths = serverEnvPaths()
    if (paths.length !== 0) {
        setEnvPath(joinEnvPath(paths) + path.delimiter + getEnvPath())
    }
    return env
}

export function getDefaultElanPath() : string {
    let elanPath = ''
    if (process.platform === 'win32') {
        elanPath = process.env.USERPROFILE + '\\.elan\\bin';
    } else {
        elanPath = process.env.HOME + '/.elan/bin';
    }
    return elanPath;
}

export function addDefaultElanPath() : void {
    const paths = getEnvPath();
    const elanPath = getDefaultElanPath();
    if (paths.indexOf(elanPath) < 0) {
        setEnvPath(paths + path.delimiter + elanPath);
    }
}

function findToolchainBin(root:string) : string{
    console.log(`Looking for toolchains in ${root}`)
    if (!fs.existsSync(root)) {
        return '';
    }
    const toolchains = fs.readdirSync(path.join(root, '..', 'toolchains'));
    for(const toolchain of toolchains) {
        if (toolchain.indexOf('leanprover--lean4') >= 0){
            return path.join(root, '..', 'toolchains', toolchains[0], 'bin');
        }
    }
    return ''
}

export function addToolchainBinPath(elanPath: string){
    const bin = findToolchainBin(elanPath)
    if (bin){
        const paths = getEnvPath();
        setEnvPath(paths + path.delimiter + bin);
    }
}

export function findProgramInPath(name: string) : string {
    if (fs.existsSync(name)) {
        return name;
    }
    const extensions : string[] = [];
    if (process.platform === 'win32') {
       extensions.push('.exe')
       extensions.push('.com')
       extensions.push('.cmd')
    } else {
       extensions.push('');
    }
    const parts = splitEnvPath(getEnvPath());
    for (const part of parts) {
         for (const ext of extensions){
            const fullPath = path.join(part, name + ext)
            if (fs.existsSync(fullPath)) {
               return fullPath;
            }
         }
    }
    return ''
}

export function removeElanPath() : string {
    const parts = splitEnvPath(getEnvPath());
    let result = ''
    for (let i = 0; i < parts.length; ) {
         const part = parts[i]
         if (part.indexOf('.elan') > 0){
            console.log(`removing path to elan: ${part}`)
            result = part;
            parts.splice(i, 1);
         } else {
            i++;
         }
    }

    setEnvPath(joinEnvPath(parts));
    return result;
}

export function getPowerShellPath() : string {
    const windir = process.env.windir
    return `${windir}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

export function toolchainPath(): string {
    return workspace.getConfiguration('lean4').get('toolchainPath', '')
}

export function lakePath(): string {
    return workspace.getConfiguration('lean4').get('lakePath', '')
}

export function lakeEnabled(): boolean {
    return workspace.getConfiguration('lean4').get('enableLake', false)
}

export function serverEnv(): object {
    return workspace.getConfiguration('lean4').get('serverEnv', {})
}

export function serverEnvPaths(): string[] {
    return workspace.getConfiguration('lean4').get('serverEnvPaths', [])
}

export function serverArgs(): string[] {
    return workspace.getConfiguration('lean4').get('serverArgs', [])
}

export function serverLoggingEnabled(): boolean {
    return workspace.getConfiguration('lean4.serverLogging').get('enabled', false)
}

export function serverLoggingPath(): string {
    return workspace.getConfiguration('lean4.serverLogging').get('path', '.')
}

export function getInfoViewStyle(): string {
    return workspace.getConfiguration('lean4').get('infoViewStyle', '');
}

export function getInfoViewAutoOpen(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAutoOpen', true);
}

export function getInfoViewAutoOpenShowGoal(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAutoOpenShowGoal', true);
}

export function getInfoViewAllErrorsOnLine(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAllErrorsOnLine', true);
}

export function getElaborationDelay(): number {
    return workspace.getConfiguration('lean4').get('elaborationDelay', 200);
}

export function getLeanExecutableName(): string {
    if (process.platform === 'win32') {
        return 'lean.exe'
    }
    return 'lean'
}

export function isRunningTest() : boolean {
    return typeof(process.env.TEST_FOLDER) === 'string';
}

export function getTestFolder() : string {
    return typeof(process.env.TEST_FOLDER) === 'string' ? process.env.TEST_FOLDER : '';
}

export function isElanDisabled() : boolean {
    return typeof(process.env.DISABLE_ELAN) === 'string';
}

/**
 * The literal 'production' or 'development', depending on the build.
 * Should be turned into a string literal by build tools.
 */
export const prodOrDev: string = process.env.NODE_ENV && process.env.NODE_ENV === 'production'
    ? 'production' : 'development'

/** The literal '.min' or empty, depending on the build. See {@link prodOrDev}. */
export const minIfProd: string = process.env.NODE_ENV && process.env.NODE_ENV === 'production'
    ? '.min' : ''
