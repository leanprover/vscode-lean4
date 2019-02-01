import { existsSync } from 'fs';
import * as hasbin from 'hasbin';
import * as leanclient from 'lean-client-js-node';
import { Event, Message, ProcessTransport, Task } from 'lean-client-js-node';
import { homedir } from 'os';
import { resolve } from 'path';
import * as username from 'username';
import { OutputChannel, TerminalOptions, window, workspace } from 'vscode';
import { LowPassFilter } from './util';

export interface ServerStatus {
    stopped: boolean;
    isRunning: boolean;
    numberOfTasks: number;
    tasks: Task[];
}

// A global channel for storing the contents of stderr.
let stderrOutput: OutputChannel;

// A class for interacting with the Lean server protocol.
export class Server extends leanclient.Server {
    transport: ProcessTransport;
    executablePath: string;
    overrideExecutablePath: string;
    hasLean: boolean;
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
                } else if(process.platform === 'win32') {
                  elanLean = resolve('C:', 'msys64', 'home', username.sync(),
                    '.elan', 'bin', 'lean');
                  if(existsSync(elanLean)) {
                    this.executablePath = elanLean;
                  }
                }
              }
            }
            this.workingDirectory = workspace.rootPath;
            this.options = config.get('extraOptions') || [];

            this.options.push('-M');
            this.options.push('' + config.get('memoryLimit'));
            this.options.push('-T');
            this.options.push('' + config.get('timeLimit'));

            this.transport = new ProcessTransport(
                this.executablePath, this.workingDirectory, this.options);
            super.connect();
            this.restarted.fire(null);
        } catch (e) {
            this.requestRestart(`Lean: ${e}`);
        }
    }

    private attachEventHandlers() {
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
                        stderrOutput.show();
                        break;
                    }
                    this.requestRestart(
                        `Lean: ${e.message}\n` +
                        'The lean.executablePath may be incorrect, make sure it is a valid Lean executable');
                    break;
                case 'unrelated':
                    window.showWarningMessage('Lean: ' + e.message);
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
        if(workspace.getConfiguration('lean').get<string>('executablePath') !== 'lean') {
            await window.showErrorMessage(
              "It looks like you've modified the `lean.executablePath` user setting.\n" +
              'Please change it back to `lean` before installing elan.');
        } else {
            this.hasLean = true;

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
                    `before we can install elan.`);
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
