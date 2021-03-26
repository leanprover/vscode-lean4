import { Config, defaultConfig, InfoviewLocation, InfoviewExtensionApi, InfoviewWebviewApi, PinnedLocation, Message } from '../src/infoviewApi';
import { Event } from './event';
import { ServerProgress } from '../src/leanclientTypes';
import {Rpc} from '../src/rpc';
declare const acquireVsCodeApi;
const vscode = acquireVsCodeApi();

const rpc = new Rpc((m) => vscode.postMessage(m));
window.addEventListener('message', (e) => rpc.messageReceived(e.data))
const serverApi: InfoviewExtensionApi = rpc.getApi();

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
    rpc.register({[name]: async (val) => ev.fire(val)});
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

rpc.register<Partial<InfoviewWebviewApi>>({
    setPaused: async (paused) => (paused ? pauseEvent : continueEvent).fire(undefined),
});
