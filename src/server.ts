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

type InfoMessage = {
    command : "info",
    file_name : string,
    line : number,
    column : number
};

function infoMessage(file_name : string, line : number, column : number) : InfoMessage {
    return {
        command : "info",
        file_name : file_name,
        line: line,
        column : column
    };
}

type CompleteMessage  = {
    command : "complete",
    file_name : string,
    line : number,
    column : number,
};
type CompleteResponse = {
    prefix: string,
    completions: Array<{type: string, text: string,}>,
};

function completeMessage(file_name : string, line : number, column: number) : CompleteMessage {
    return {
        command : "complete",
        file_name : file_name,
        line : line,
        column : column,
    };
}

class SequenceMap {
    [index : number] : (a : any) => any;
}

type Message = {
    file_name : string,
    pos_line : number,
    pos_col : number,
    severity : string,
    caption : string,
    text : string
};



// A class for interacting with the Lean server protoccol.
class Server {
    executablePath : string;
    process : child.ChildProcess;
    sequenceNumber : number;
    messages : Array<Message>;
    senders : SequenceMap;
    onMessageCallback : (a : any) => any;

    constructor(executablePath : string, projectRoot : string) {
        this.executablePath = executablePath || "lean";

        this.process = child.spawn(this.executablePath, defaultServerOptions,
            { cwd: projectRoot });

        this.sequenceNumber = 0;
        this.senders = {};
        this.messages = [];

        this.attachEventHandlers();
    }

    attachEventHandlers() {
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
                console.log("unsupported message: ", line);
            }
        });

        this.process.stderr.on('data', (data) => {
            console.log(`stderr: ${data}`);
        });

        this.process.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
        });
    }

    handleAllMessages(all_messages) {
        this.messages = all_messages.msgs;
        if (this.onMessageCallback) {
            this.onMessageCallback(this.messages);
        }
    }

    handleAdditionalMessage(additional_message) {
        this.messages.push(additional_message.msg);
        if (this.onMessageCallback) {
            this.onMessageCallback(this.messages);
        }
    }

    send(message, callback : (a : any) => any) {
        // console.log(message);
        let seq_num = this.sequenceNumber;
        message['seq_num'] = this.sequenceNumber;
        let json = JSON.stringify(message);
        this.sequenceNumber = this.sequenceNumber + 1;
        this.senders[seq_num] = callback;
        // console.log("about to send: " + json);
        this.process.stdin.write(json + "\n");
    }

    info(file : string, line : number, column : number) : Promise<any> {
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

    complete(file: string, line: number, column: number): Promise<CompleteResponse> {
        let message = completeMessage(file, line, column);
        return new Promise((resolve, reject) => {
            this.send(message, resolve);
        });
    }

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    restart(projectRoot : string) {
        this.process.kill();
        this.process = child.spawn(
            this.executablePath,
            defaultServerOptions,
            { cwd: projectRoot });
        this.attachEventHandlers();
    }

    dispose() {
        this.process.kill();
    }
};

export { Server };
