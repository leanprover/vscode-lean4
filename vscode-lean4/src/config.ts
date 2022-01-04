import { workspace } from 'vscode'
import { InfoviewTacticStateFilter } from '@lean4/infoview-api';
import * as path from 'path';

// TODO: does currently not contain config options for `./abbreviation`
// so that it is easy to keep it in sync with vscode-lean.

export function getEnvPath() : string {
    if (process.platform === 'win32') {
        return process.env.Path
    } else {
        return process.env.PATH
    }
}

export function setEnvPath(value : string) : void {
    if (process.platform === 'win32') {
        process.env.Path = value
    } else {
        process.env.PATH = value
    }
}

// Make a copy of the passed process environment that includes the user's
// `lean4.serverEnvPaths` in the path key, and adds the key/value pairs from
// `lean4.serverEnv`. Both of these settings can be found in the user's
// settings.json file
export function addServerEnvPaths(input_env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = Object.assign({}, input_env, serverEnv());
    const paths = serverEnvPaths()
    if (paths.length !== 0) {
        setEnvPath(paths.join(path.delimiter) + path.delimiter + getEnvPath())
    }
    return env
}

export function addDefaultElanPath() : void {
    const paths = getEnvPath();
    let elanPath = process.env.HOME + '/.elan/bin';
    if (process.platform === 'win32') {
        elanPath = process.env.USERPROFILE + '\\.elan\\bin';
    }
    if (paths.indexOf(elanPath) < 0) {
        setEnvPath(paths + path.delimiter + elanPath);
    }
}

export function executablePath(): string {
    return workspace.getConfiguration('lean4').get('executablePath', 'lean')
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
    return workspace.getConfiguration('lean4').get('infoViewStyle');
}

export function getInfoViewAutoOpen(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAutoOpen');
}

export function getInfoViewAutoOpenShowGoal(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAutoOpenShowGoal', true);
}

export function getInfoViewAllErrorsOnLine(): boolean {
    return workspace.getConfiguration('lean4').get('infoViewAllErrorsOnLine', true);
}

export function getInfoViewTacticStateFilters(): InfoviewTacticStateFilter[] {
    return workspace.getConfiguration('lean4').get('infoViewTacticStateFilters', []);
}

export function getInfoViewFilterIndex(): number {
    return workspace.getConfiguration('lean4').get('infoViewFilterIndex', -1);
}

export function getElaborationDelay(): number {
    return workspace.getConfiguration('lean4').get('elaborationDelay', 200);
}
