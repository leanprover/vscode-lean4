'use strict';

import * as child from 'child_process';
import * as carrier from 'carrier';

const defaultServerOptions = [
    "--server",
];

type SyncMessage = { command : "sync", file_name : string, content : string }

function syncMessage(file_name : string , contents : string) : SyncMessage {
    return {
        command : "sync",
        file_name : file_name,
        content : contents
    };
}

type InfoMessage = { command : string, file_name : string, line : number, column : number };

function infoMessage(file_name : string, line : number, column : number) : InfoMessage {
    return {
        command : "info",
        file_name : file_name,
        line: line,
        column : column
    };
}

type CommandMessage  = { command : string, file_name : string, line : number, pattern : string };

function completeMessage(file_name : string, line : number, pattern : string) : CommandMessage {
    return {
        command : "complete",
        file_name : file_name,
        line : line,
        pattern : pattern
    };
}

class SequenceMap {
    [index : number] : (a : any) => any;
}

type Message = { file_name : string, pos_line : number, pos_col : number, severity : string, caption : string, text : string };

// A class for interacting with the Lean server protoccol.
class Server {
    process : child.ChildProcess;
    sequence_number : number;
    messages : Array<Message>;
    senders : SequenceMap;
    on_message_callback : (a : any) => any;

    constructor(executable_path : string, project_root : string) {
        if (executable_path == '') {
            executable_path = "lean";
        }
        this.process = child.spawn(executable_path, defaultServerOptions,
            { cwd: project_root });

        this.sequence_number = 0;
        this.senders = {};
        this.messages = [];

        carrier.carry(this.process.stdout, (line) => {
            let message = JSON.parse(line);
            let response = message['response'];
            if (response === "ok") {
                let seq_num = message['seq_num'];
                let callback = this.senders[seq_num];
                callback(message);
            } else if (response === "all_messages") {
                this.handleAllMessages(message);
            } else if (response === "additional_message") {
                this.handleAdditionalMessage(message);
            } else {
                console.log(line);
                console.log("unsupported")
            }
        });

        this.process.stderr.on('data', (data) => {
            console.log(`stderr: ${data}`);
            // throw "unhandled error"
        });

        this.process.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
        });
    }

    handleAllMessages(all_messages) {
        this.messages = all_messages.msgs;
        if (this.on_message_callback) {
            this.on_message_callback(this.messages);
        }
    }

    handleAdditionalMessage(additional_message) {
        this.messages.push(additional_message.msg);
        if (this.on_message_callback) {
            this.on_message_callback(this.messages);
        }
    }

    send(message, callback : (a : any) => any) {
        // console.log(message);
        let seq_num = this.sequence_number;
        message['seq_num'] = this.sequence_number;
        let json = JSON.stringify(message);
        this.sequence_number = this.sequence_number + 1;
        this.senders[seq_num] = callback;
        // console.log("about to send: " + json);
        this.process.stdin.write(json + "\n");
    }

    info(file, line, column) : Promise<any> {
        let message = infoMessage(file, line, column);
        return new Promise((resolve, reject) => {
            this.send(message, resolve);
        });
    }

    sync(file, contents) {
        let message = syncMessage(file, contents);
        return new Promise((resolve, reject) => {
            this.send(message, resolve);
        })
    }

    complete(file, line, pattern) {
        let message = completeMessage(file, line, pattern);
        return new Promise((resolve, reject) => {
            this.send(message, resolve);
        });
    }

    onMessage(callback) {
        this.on_message_callback = callback;
    }
};

export { Server };