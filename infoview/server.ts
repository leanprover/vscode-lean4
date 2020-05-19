import { Server, Transport, Connection, Event, TransportError } from 'lean-client-js-core';
import { ToInfoviewMessage, FromInfoviewMessage } from '../src/typings';
declare const acquireVsCodeApi;
const vscode = acquireVsCodeApi();

export function post(message: FromInfoviewMessage) { // send a message to the extension
    vscode.postMessage(message);
}

class ProxyTransport implements Transport {
    connect(): Connection {
        return new ProxyConnection();
    }
    constructor() { }
}

/** Forwards all of the messages between extension and webview. */
class ProxyConnection implements Connection {
    error: Event<TransportError>;
    jsonMessage: Event<any>;
    alive: boolean;
    messageListener;
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
        this.messageListener = event => { // messages from the extension
            const message: ToInfoviewMessage = event.data; // The JSON data our extension sent
            // console.log('incoming:', message);
            switch (message.command) {
                case 'server_event': {
                    const payload = JSON.parse(message.payload);
                    this.jsonMessage.fire(payload);
                    break;
                }
                case 'server_error': {
                    const payload = JSON.parse(message.payload);
                    this.error.fire(payload);
                    break;
                }
            }
        };
        window.addEventListener('message', this.messageListener);
    }
}

export const global_server = new Server(new ProxyTransport());
global_server.logMessagesToConsole = true;
global_server.connect();