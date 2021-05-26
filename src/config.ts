import { workspace } from 'vscode'
import { InfoViewTacticStateFilter } from './infoviewApi';
import * as path from 'path';

// TODO: does currently not contain config options for `./abbreviation`
// so that it is easy to keep it in sync with vscode-lean.

// Make a copy of the passed process environment that includes the user's
// `lean4.serverEnvPaths` in the path key, and adds the key/value pairs from
// `lean4.serverEnv`. Both of these settings can be found in the user's 
// settings.json file
export function addServerEnvPaths(input_env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    let env = Object.assign({}, input_env, serverEnv());
    let paths = serverEnvPaths()
    if (paths.length != 0) {
        if (process.platform === 'win32') {
            env['Path'] = paths.join(path.delimiter) + path.delimiter + process.env.Path
        } else {
            env['PATH'] = paths.join(path.delimiter) + path.delimiter + process.env.PATH
        }
    }  
    return env
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

export function getInfoViewTacticStateFilters(): InfoViewTacticStateFilter[] {
    return workspace.getConfiguration('lean4').get('infoViewTacticStateFilters', []);
}

export function getInfoViewFilterIndex(): number {
    return workspace.getConfiguration('lean4').get('infoViewFilterIndex', -1);
}

export function getElaborationDelay(): number {
    return workspace.getConfiguration('lean4').get('elaborationDelay', 200);
}