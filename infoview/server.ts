import { Config, defaultConfig, InfoviewLocation, InfoviewExtensionApi, InfoviewWebviewApi, obtainApi, PinnedLocation, registerApi, Message } from '../src/infoviewApi';
import { RpcBrowser } from '@sap-devx/webview-rpc/out.browser/rpc-browser.js';
import { Event } from './event';
import { ServerProgress } from '../src/leanclientTypes';
declare const acquireVsCodeApi;
const vscode = acquireVsCodeApi();

const rpc = new RpcBrowser(window, vscode);
const serverApi: InfoviewExtensionApi = obtainApi(rpc);

export function copyToComment(text: string): Promise<unknown> {
    return serverApi.insertText(`/-\n${text}\n-/\n`, 'relative');
}

// eslint-disable-next-line @typescript-eslint/unbound-method
export const {reveal, copyText, syncPins, requestPlainGoal} = serverApi;

// eslint-disable-next-line @typescript-eslint/unbound-method
export const edit = serverApi.insertText;

function registerEvent<Name extends keyof InfoviewWebviewApi>(name: Name):
        (InfoviewWebviewApi[Name] extends (_: infer T) => Promise<unknown> ? Event<T> : void) {
    const ev = new Event();
    registerApi(rpc, {[name]: async (val) => ev.fire(val)});
    return ev as any;
}

export const position: Event<InfoviewLocation> = registerEvent('position');
export const configEvent: Event<Config> = registerEvent('setConfig');
export const syncPinsEvent: Event<PinnedLocation[]> = registerEvent('syncPins');
export const pauseEvent: Event<unknown> = new Event();
export const continueEvent: Event<unknown> = new Event();
export const toggleUpdating: Event<unknown> = registerEvent('toggleUpdating');
export const copyToCommentEvent: Event<unknown> = registerEvent('copyToComment');
export const togglePinEvent: Event<unknown> = registerEvent('togglePin');
export const serverRestarted: Event<unknown> = registerEvent('restarted');
export const allMessagesEvent: Event<Message[]> = registerEvent('messages');
export const toggleAllMessagesEvent: Event<unknown> = registerEvent('toggleAllMessages');
export const progressEvent: Event<ServerProgress> = registerEvent('progress');

allMessagesEvent.current = [];
configEvent.current = defaultConfig;
serverRestarted.on(() => allMessagesEvent.current = []);

registerApi<Partial<InfoviewWebviewApi>>(rpc, {
    setPaused: async (paused) => (paused ? pauseEvent : continueEvent).fire(undefined),
});
