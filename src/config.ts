import { workspace } from 'vscode'
import { InfoViewTacticStateFilter } from './infoviewApi';

// TODO: does currently not contain config options for `./abbreviation`
// so that it is easy to keep it in sync with vscode-lean.

export function executablePath(): string {
    return workspace.getConfiguration('lean4').get('executablePath', 'lean')
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