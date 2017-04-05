import * as child from 'child_process';
import * as carrier from 'carrier';
import * as vscode from 'vscode';
import * as util from './util';

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

type CompletionCandidate = {
    type?: string,
    tactic_params?: Array<string>,
    text: string,
    doc?: string,
};

type CompleteResponse = {
    prefix: string,
    completions: Array<CompletionCandidate>,
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
    end_pos_line : number,
    end_pos_col : number,
    severity : string,
    caption : string,
    text : string
};

type Task = {
    file_name: string,
    pos_line: number,
    pos_col: number,
    end_pos_line: number,
    end_pos_col: number,
    desc: string,
};

export type LineRange = {
    begin_line: number,
    end_line: number,
};

export type FileRoi = {
    file_name: string,
    ranges: Array<LineRange>,
};

export type Roi = Array<FileRoi>;
function roiMessage(mode: string, files: Array<FileRoi>) {
    return {
        command: "roi",
        mode: mode,
        files: files,
    };
}

export type ServerStatus = {
    stopped : boolean,
    isRunning : boolean,
    numberOfTasks : number,
    tasks: Array<Task>,
};

let stderrOutput : vscode.OutputChannel = vscode.window.createOutputChannel("Lean Server Errors");

// A class for interacting with the Lean server protocol.
class Server {
    executablePath : string;
    process : child.ChildProcess;
    sequenceNumber : number;
    messages : Array<Message>;
    tasks : Array<Task>;
    senders : SequenceMap;
    options : Array<string>;
    onMessageCallback : (msgs: Message[]) => any;
    onStatusChangeCallback : (serverStatus : ServerStatus) => any;
    supportsROI : Boolean;

    constructor(executablePath : string, projectRoot : string, memoryLimit : number, timeLimit : number) {
        this.executablePath = executablePath || "lean";

        // Note: on Windows the PATH variable must be set since
        // the standard msys2 installation paths are not added to the
        // Windows Path by msys2. We could instead people to set the
        // path themselves but it seems like a lot of extra friction.
        //
        // This is also tricky since there is very little way to give
        // feedback when shelling out to Lean fails. Node.js appears
        // fail to start without writing any output to standard error.
        //
        // For now we just set the path with low priority and invoke the process.

        this.options = defaultServerOptions.slice(0);

        if (util.atLeastLeanVersion("3.1.0")) {
            this.options.push("-M")
            this.options.push(memoryLimit.toString())

            this.options.push("-T")
            this.options.push(timeLimit.toString())
        }

        this.supportsROI = util.atLeastLeanVersion("3.1.1");

        this.process = child.spawn(this.executablePath, this.options,
            { cwd: projectRoot, env: util.getEnv() });

        this.sequenceNumber = 0;
        this.senders = {};
        this.messages = [];
        this.tasks = [];

        this.attachEventHandlers();
    }

    attachEventHandlers() {
        // Setup the output handler.
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
            } else if (response === "current_tasks") {
                this.handleCurrentTasks(message);
            } else {
                console.log("unsupported message: ", line);
                // TODO(jroesch): We should have a mechanism for asking to report errors like this directly to the mode.
            }
        });

        // When attaching event handlers ensure the global error log is clear.
        stderrOutput = stderrOutput || vscode.window.createOutputChannel("Lean: Server Errors");
        stderrOutput.clear();

        this.process.stderr.on('data', (data) => {
            console.log(`stderr: ${data}`);
            stderrOutput.append(data.toString());
        });

        this.process.on('error', (e) => {
            vscode.window.showErrorMessage(
                "Unable to start the Lean server process: " + e);
            vscode.window.showWarningMessage(
                "The lean.executablePath may be incorrect, make sure it is a valid Lean executable");
        });

        this.process.on('close', (code) => {
            vscode.window.showErrorMessage(
                `The Lean server has stopped with error code ${code}.`, "Show error log")
            .then((action : string | undefined) => {
                if (action === "Show error log") {
                    stderrOutput.show();
                }
            });

             this.onStatusChangeCallback({
                isRunning: false,
                numberOfTasks: 0,
                stopped: true,
                tasks: [],
            });
        });
    }

    messagesChanged() {
        if (this.onMessageCallback) {
            this.onMessageCallback(this.messages);
        }
    }

    handleAllMessages(all_messages) {
        this.messages = all_messages.msgs || [];
        this.messagesChanged();
    }

    handleAdditionalMessage(additional_message) {
        this.messages.push(additional_message.msg);
        this.messagesChanged();
    }

    handleCurrentTasks(current_tasks) {
        this.tasks = current_tasks.tasks;

        this.onStatusChangeCallback({
            isRunning: current_tasks.is_running,
            numberOfTasks: current_tasks.tasks.length,
            stopped: false,
            tasks: this.tasks,
        });
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

    roi(mode: string, files: Array<FileRoi>): Promise<any> {
        let message = roiMessage(mode, files);
        return new Promise((resolve, reject) => this.send(message, resolve));
    }

    onMessage(callback: (msgs: Message[]) => any) {
        this.onMessageCallback = callback;
    }

    onStatusChange(callback) {
        this.onStatusChangeCallback = callback;
    }

    restart(projectRoot : string) {
        this.process.kill();
        this.process = child.spawn(
            this.executablePath,
            this.options,
            { cwd: projectRoot });
        this.attachEventHandlers();
        stderrOutput.appendLine("User triggered restart");
        stderrOutput.appendLine("----------------------");
    }

    dispose() {
        this.process.kill();
    }
};

export { Server };
