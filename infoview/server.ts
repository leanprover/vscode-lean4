import { Server, Transport, Connection, Event, TransportError, Message } from 'lean-client-js-core';
import { ToInfoviewMessage, FromInfoviewMessage, Config, Location, defaultConfig, PinnedLocation, InsertTextMessage } from '../src/shared';
declare const acquireVsCodeApi;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const vscode = acquireVsCodeApi();

export function post(message: FromInfoviewMessage): void { // send a message to the extension
    vscode.postMessage(message);
}

export function clearHighlight(): void { return post({ command: 'stop_hover'}); }
export function highlightPosition(loc: Location): void { return post({ command: 'hover_position', loc}); }
export function copyToComment(text: string): void {
    post({ command: 'insert_text', text: `/-\n${text}\n-/\n`, insert_type: 'relative'});
}

export function reveal(loc: Location): void {
    post({ command: 'reveal', loc });
}

export function edit(loc: Location, text: string, insert_type : InsertTextMessage['insert_type'] = 'relative'): void {
    post({ command: 'insert_text', loc, text, insert_type });
}

export function copyText(text: string): void {
    post({ command: 'copy_text', text});
}

export const PositionEvent: Event<Location> = new Event();
export let globalCurrentLoc: Location = null;
PositionEvent.on((loc) => globalCurrentLoc = loc);

export let currentConfig: Config = defaultConfig;
export const ConfigEvent: Event<Config> = new Event();

ConfigEvent.on(c => {
    console.log('config updated: ', c);
});
export const SyncPinEvent: Event<{pins: PinnedLocation[]}> = new Event();
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

window.addEventListener('message', event => { // messages from the extension
    const message = event.data as ToInfoviewMessage; // The JSON data our extension sent
    switch (message.command) {
        case 'position': PositionEvent.fire(message.loc); break;
        case 'on_config_change':
            currentConfig = { ...currentConfig, ...message.config };
            ConfigEvent.fire(currentConfig);
            break;
        case 'sync_pin': SyncPinEvent.fire(message); break;
        case 'pause': PauseEvent.fire(message); break;
        case 'continue': ContinueEvent.fire(message); break;
        case 'toggle_updating': ToggleUpdatingEvent.fire(message); break;
        case 'copy_to_comment': CopyToCommentEvent.fire(message); break;
        case 'toggle_pin': TogglePinEvent.fire(message); break;
        case 'restart': ServerRestartEvent.fire(message); break;
        case 'all_messages': AllMessagesEvent.fire(message.messages); break;
        case 'toggle_all_messages': ToggleAllMessagesEvent.fire({}); break;
        case 'server_event': break;
        case 'server_error': break;
    }
});

class ProxyTransport implements Transport {
    connect(): Connection {
        return new ProxyConnectionClient();
    }
    constructor() { }
}

/** Forwards all of the messages between extension and webview.
 * See also makeProxyTransport on the server.
 */
class ProxyConnectionClient implements Connection {
    error: Event<TransportError>;
    jsonMessage: Event<any>;
    alive: boolean;
    messageListener: (event: MessageEvent) => void;
    send(jsonMsg: any) {
        post({
            command: 'server_request',
            payload: JSON.stringify(jsonMsg),
        })
    }
    dispose() {
        this.jsonMessage.dispose();
        this.error.dispose();
        this.alive = false;
        window.removeEventListener('message', this.messageListener);
    }
    constructor() {
        this.alive = true;
        this.jsonMessage = new Event();
        this.error = new Event();
        this.messageListener = (event) => { // messages from the extension
            const message = event.data as ToInfoviewMessage; // The JSON data our extension sent
            // console.log('incoming:', message);
            switch (message.command) {
                case 'server_event': {
                    this.jsonMessage.fire(JSON.parse(message.payload));
                    break;
                }
                case 'server_error': {
                    this.error.fire(JSON.parse(message.payload));
                    break;
                }
            }
        };
        window.addEventListener('message', this.messageListener);
    }
}

export const global_server = new Server(new ProxyTransport());
global_server.logMessagesToConsole = true;
global_server.allMessages.on(x => AllMessagesEvent.fire(x.msgs));
global_server.connect();

post({command:'request_config'});