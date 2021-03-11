import { Config, defaultConfig, InfoviewLocation, InfoviewExtensionApi, InfoviewWebviewApi, obtainApi, PinnedLocation, registerApi, Message } from '../src/infoviewApi';
import { RpcBrowser } from '@sap-devx/webview-rpc/out.browser/rpc-browser.js';
import { Event } from './event';
declare const acquireVsCodeApi;
const vscode = acquireVsCodeApi();

const rpc = new RpcBrowser(window, vscode);
export const serverApi: InfoviewExtensionApi = obtainApi(rpc);

export function copyToComment(text: string): Promise<unknown> {
    return serverApi.insertText(`/-\n${text}\n-/\n`, 'relative');
}

// eslint-disable-next-line @typescript-eslint/unbound-method
export const reveal = serverApi.reveal;

// eslint-disable-next-line @typescript-eslint/unbound-method
export const edit = serverApi.insertText;

// eslint-disable-next-line @typescript-eslint/unbound-method
export const copyText = serverApi.copyText;

export const PositionEvent: Event<InfoviewLocation> = new Event();
export let globalCurrentLoc: InfoviewLocation = null;
PositionEvent.on((loc) => globalCurrentLoc = loc);

export let currentConfig: Config = defaultConfig;
export const ConfigEvent: Event<Config> = new Event();

ConfigEvent.on(c => console.log('config updated: ', c));
export const SyncPinEvent: Event<PinnedLocation[]> = new Event();
export const PauseEvent: Event<unknown> = new Event();
export const ContinueEvent: Event<unknown> = new Event();
export const ToggleUpdatingEvent: Event<unknown> = new Event();
export const CopyToCommentEvent: Event<unknown> = new Event();
export const TogglePinEvent: Event<unknown> = new Event();
export const ServerRestartEvent: Event<unknown> = new Event();
export const AllMessagesEvent: Event<Message[]> = new Event();
export const ToggleAllMessagesEvent: Event<unknown> = new Event();

export let currentAllMessages: Message[] = [];
AllMessagesEvent.on((msgs) => currentAllMessages = msgs);
ServerRestartEvent.on(() => currentAllMessages = []);

registerApi<InfoviewWebviewApi>(rpc, {
    position: async (pos) => PositionEvent.fire(pos),
    setConfig: async (config) => {
        currentConfig = config;
        ConfigEvent.fire(currentConfig);
    },
    syncPins: async (pins) => SyncPinEvent.fire(pins),
    setPaused: async (paused) => (paused ? PauseEvent : ContinueEvent).fire(undefined),
    toggleUpdating: async () => ToggleUpdatingEvent.fire(undefined),
    copyToComment: async () => CopyToCommentEvent.fire(undefined),
    togglePin: async () => TogglePinEvent.fire(undefined),
    restarted: async () => ServerRestartEvent.fire(undefined),
    messages: async (msgs) => AllMessagesEvent.fire(msgs),
    toggleAllMessages: async () => ToggleAllMessagesEvent.fire(undefined),
});
