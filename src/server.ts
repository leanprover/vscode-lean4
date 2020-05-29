import { existsSync } from 'fs';
import * as hasbin from 'hasbin';
import * as leanclient from 'lean-client-js-node';
import { Event, Message, ProcessTransport, Task } from 'lean-client-js-node';
import { homedir } from 'os';
import { resolve } from 'path';
import * as username from 'username';
import { extensions, OutputChannel, TerminalOptions, window, workspace } from 'vscode';
import { LowPassFilter } from './util';
import { ServerStatus } from './typings';


const MAX_MESSAGES = 2**13;
const MAX_MESSAGE_SIZE = 2**18;
function truncateMessages(msgs: Message[]): Message[] {
    if (msgs.length >= MAX_MESSAGES) {
        msgs = msgs.slice(0, MAX_MESSAGES - 1);
        msgs.push({
            ...msgs.pop(),
            severity: 'error',
            caption: undefined,
            text: `Too many errors, only showing the first ${MAX_MESSAGES}.`,
        });
    }
    msgs = msgs.map((msg) => ({
        ...msg,
        text: msg.text.length <= MAX_MESSAGE_SIZE ? msg.text :
            msg.text.slice(0, MAX_MESSAGE_SIZE) +
                `\n(message too long, truncated at ${MAX_MESSAGE_SIZE} characters)`,
    }));
    return msgs;
}

// A global channel for storing the contents of stderr.
let stderrOutput: OutputChannel;

// A class for interacting with the Lean server protocol.
export class Server extends leanclient.Server {
    transport: ProcessTransport;
    executablePath: string;
    hasLean: boolean = false;        // have we found a usable copy of Lean yet?
    workingDirectory: string;
    options: string[];

    statusChanged: LowPassFilter<ServerStatus>;
    restarted: Event<any>;

    messages: Message[];

    constructor() {
        super(null); // TODO(gabriel): add support to lean-client-js
        this.statusChanged = new LowPassFilter<ServerStatus>(300);
        this.restarted = new Event();
        this.messages = [];

        this.attachEventHandlers();
    }

    connect() {
        try {
            this.messages = [];

            const config = workspace.getConfiguration('lean');

            // TODO(gabriel): unset LEAN_PATH environment variable

            this.executablePath = config.get('executablePath') || 'lean';
            if(this.executablePath === 'lean') {
              if(!hasbin.sync('lean')) {
                // Let's try a little harder!
                let elanLean = resolve(homedir(), '.elan', 'bin', 'lean');
                if(existsSync(elanLean)) {
                    this.executablePath = elanLean;
                    this.hasLean = true;
                } else if(process.platform === 'win32') {
                  elanLean = resolve('C:', 'msys64', 'home', username.sync(),
                    '.elan', 'bin', 'lean');
                  if(existsSync(elanLean)) {
                    this.executablePath = elanLean;
                    this.hasLean = true;
                  }
                } else {
                    this.hasLean = false;
                }
              } else {
                this.hasLean = true;
              }
            }

            this.workingDirectory = workspace.rootPath;
            this.options = config.get('extraOptions') || [];

            this.options.push('-M');
            this.options.push('' + config.get('memoryLimit'));
            this.options.push('-T');
            this.options.push('' + config.get('timeLimit'));

            const {extensionPath} = extensions.getExtension('jroesch.lean');
            const executablePath = this.executablePath.replace('%extensionPath%', extensionPath + '/');
            this.transport = new ProcessTransport(
                executablePath, this.workingDirectory, this.options);
            super.connect();

            this.restarted.fire(null);

        } catch (e) {
            this.requestRestart(e.message);
        }
    }

    private attachEventHandlers() {
        // HACK: limit number and size of messages, see
        // https://leanprover-community.github.io/archive/113488general/25177foldingproblemsproblem.html
        this.allMessages.on((res) => res.msgs = truncateMessages(res.msgs));

        // When attaching event handlers ensure the global error log is clear.
        stderrOutput = stderrOutput || window.createOutputChannel('Lean: Server Errors');
        stderrOutput.clear();

        this.error.on((e) => {
            switch (e.error) {
                case 'stderr':
                    stderrOutput.append(e.chunk);
                    stderrOutput.show();
                    break;
                case 'connect':
                    // json parsing errors
                    if (e.message.startsWith('cannot parse: ')) {
                        stderrOutput.append(e.message + '\n');
                        // stderrOutput.show();
                        break;
                    }
                    const msg = e.message.startsWith('Unable to start') ?
                        ` --- The lean.executablePath "${this.executablePath}" ` +
                        'may be incorrect, make sure it is a valid Lean executable' : '';
                    this.requestRestart(e.message + msg);
                    break;
                case 'unrelated':
                    window.showWarningMessage(e.message);
                    break;
            }

            if (!this.alive()) {
                this.statusChanged.input({
                    isRunning: false,
                    numberOfTasks: 0,
                    stopped: true,
                    tasks: [],
                }, true);
            }
        });

        this.allMessages.on((msgs) => this.messages = msgs.msgs);

        this.tasks.on((curTasks) =>
            this.statusChanged.input({
                isRunning: curTasks.is_running,
                numberOfTasks: curTasks.tasks.length,
                stopped: false,
                tasks: curTasks.tasks,
            }, curTasks.tasks.length === 0));
    }

    restart() {
        super.restart();
        stderrOutput.appendLine('----- user triggered restart -----');
    }

    async installElan() {
        if(this.executablePath !== 'lean') {
            await window.showErrorMessage(
              "It looks like you've modified the `lean.executablePath` user setting.\n" +
              'Please change it back to an empty string before installing elan.');
        } else {
            this.hasLean = true; // make sure we only prompt to install elan once

            const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
            const msysBashPath = 'C:\\msys64\\usr\\bin\\bash.exe';

            const terminalName = 'Lean installation via elan';

            const terminalOptions: TerminalOptions = { name: terminalName };
            if(process.platform === 'win32') {
              if(existsSync(gitBashPath)) {
                terminalOptions.shellPath = gitBashPath;
                terminalOptions.shellArgs = [];
              } else if(existsSync(msysBashPath)) {
                terminalOptions.shellPath = msysBashPath;
                terminalOptions.shellArgs = ['--login', '-i'];
              } else {
                  await window.showErrorMessage(
                    "You'll need to install a terminal (e.g. Git for Windows, or MSYS2)\n" +
                    'before we can install elan.');
                  return;
              }
            }
            const terminal = window.createTerminal(terminalOptions);

            // We register a listener, to restart the Lean extension once elan has finished.
            window.onDidCloseTerminal((t) => {
            if (t.name === terminalName) {
                this.restart();
            }});

            // Now show the terminal and run elan.
            terminal.show();
            terminal.sendText(
              'curl https://raw.githubusercontent.com/Kha/elan/master/elan-init.sh -sSf | sh && ' +
              'echo && read -n 1 -s -r -p "Press any key to start Lean" && exit\n');
        }
    }

    async requestRestart(message: string, justWarning?: boolean) {
        const restartItem = 'Restart server';
        const installElanItem = 'Install Lean using elan';

        const showMsg = justWarning ? window.showWarningMessage : window.showErrorMessage;
        const item = this.hasLean ? await showMsg(message, restartItem)
                                        : await showMsg(message, restartItem, installElanItem);
        if (item === restartItem) {
            this.restart();
        } else if (item === installElanItem) {
            this.installElan();
        }
    }
}

// [hack] this needs to be made a PR for lean-client-js-core
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
leanclient.Server.prototype.makeProxyConnection = function () {
    const translate: Map<number,number> = new Map();
    const jsonMessage: Event<any> = new Event();
    const error: Event<any> = new Event();
    const send = (jsonMsg: any) => {
        const {seq_num, ...req} = jsonMsg;
        if (seq_num) {
            const new_seq_num = this.currentSeqNum++;
            new Promise((res, reject) => this.sentRequests.set(new_seq_num, {resolve : res, reject}));
            translate.set(new_seq_num, seq_num);
            this.conn.send({seq_num : new_seq_num, ...req});
        } else {
            throw new Error('expected message to have a seq num');
        }
    }
    const h1 = this.conn.jsonMessage.on(x => {
        if (x.seq_num) {
            const {seq_num, ...rest} = x;
            const old_seq_num = translate.get(seq_num);
            if (seq_num !== undefined) {
                translate.delete(seq_num);
                jsonMessage.fire({seq_num : old_seq_num, ...rest});
            }
        } else {
            jsonMessage.fire(x);
        }
    });
    const h2 = this.conn.error.on(x => error.fire(x));
    const dispose = () => {
        error.dispose();
        jsonMessage.dispose();
        h1.dispose();
        h2.dispose();
    }
    return {
        alive: true,
        error,
        jsonMessage,
        send,
        dispose
    }
}

