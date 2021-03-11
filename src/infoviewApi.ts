import { RpcCommon } from '@sap-devx/webview-rpc/out.ext/rpc-common'

export interface InfoviewLocation {
    uri: string;
    line: number;
    character: number;
}

export interface PinnedLocation extends InfoviewLocation {
    key: number;
}

export function locationEq(l1: InfoviewLocation, l2: InfoviewLocation): boolean {
    return l1.uri === l2.uri && l1.line === l2.line && l1.character === l2.character;
}

export interface InfoViewTacticStateFilter {
    name?: string;
    regex: string;
    match: boolean;
    flags: string;
}

export interface Config {
    filterIndex: number;
    infoViewTacticStateFilters: InfoViewTacticStateFilter[];
    infoViewAllErrorsOnLine: boolean;
    infoViewAutoOpenShowGoal: boolean;
}
export const defaultConfig: Config = {
    filterIndex: -1,
    infoViewTacticStateFilters: [],
    infoViewAllErrorsOnLine: true,
    infoViewAutoOpenShowGoal: true,
}

export type MessageSeverity = number;

export interface Message extends InfoviewLocation {
    severity: MessageSeverity;
    message: string;
}
export interface PlainGoal {
    rendered: string;
    // since 2021-03-10
    goals?: string[];
}

export interface InfoviewExtensionApi {
    syncPins(pins: PinnedLocation[]): Promise<unknown>;
    copyText(text: string): Promise<unknown>;
    requestPlainGoal(loc: InfoviewLocation): Promise<PlainGoal>;
    reveal(loc: InfoviewLocation): Promise<unknown>;

    /** If no location is given set to be the cursor position. */
    insertText(text: string, insertType: 'absolute' | 'relative', loc?: InfoviewLocation): Promise<unknown>;
}

export interface InfoviewWebviewApi {
    restarted(): Promise<unknown>;
    syncPins(pins: PinnedLocation[]): Promise<unknown>;
    position(loc: InfoviewLocation): Promise<unknown>;
    setConfig(config: Config): Promise<unknown>;
    messages(messages: Message[]): Promise<unknown>;
    setPaused(paused: boolean): Promise<unknown>;
    toggleAllMessages(): Promise<unknown>;
    toggleUpdating(): Promise<unknown>;
    togglePin(): Promise<unknown>;
    copyToComment(): Promise<unknown>;
}

export function obtainApi<T>(rpc: RpcCommon): T {
    return new Proxy({}, {
        get: (_, prop) => (...args) =>
            rpc.invoke(prop as string, args)
    }) as any
}

export function registerApi<T>(rpc: RpcCommon, api: T): void {
    for (const name of Object.getOwnPropertyNames(api)) {
        rpc.registerMethod({name, func: api[name] as Function})
    }
}
