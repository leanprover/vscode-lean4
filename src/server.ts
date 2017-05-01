import * as child from 'child_process';
import * as carrier from 'carrier';
import * as vscode from 'vscode';
import * as util from './util';
import * as leanclient from 'lean-client-js-node';
import {Task, Event, ProcessTransport, ProcessConnection, CommandResponse, CompleteResponse, FileRoi, RoiRequest} from 'lean-client-js-node';

export type ServerStatus = {
    stopped : boolean,
    isRunning : boolean,
    numberOfTasks : number,
    tasks: Task[],
};

// A global channel for storing the contents of stderr.
let stderrOutput : vscode.OutputChannel;

// A class for interacting with the Lean server protocol.
class Server extends leanclient.Server {
    executablePath: string;
    workingDirectory: string;
    options: string[];
    statusChanged: util.LowPassFilter<ServerStatus>;
    restarted: Event<any>;
    supportsROI: Boolean;

    constructor(executablePath : string, workingDirectory : string, memoryLimit : number, timeLimit : number) {
        executablePath = executablePath || "lean";

        const options: string[] = [];

        if (util.atLeastLeanVersion("3.1.0")) {
            options.push("-M")
            options.push(memoryLimit.toString())

            options.push("-T")
            options.push(timeLimit.toString())
        }

        super(new ProcessTransport(executablePath, workingDirectory, options));
        this.statusChanged = new util.LowPassFilter<ServerStatus>(300);
        this.restarted = new Event();

        this.executablePath = executablePath;
        this.workingDirectory = workingDirectory;
        this.supportsROI = util.atLeastLeanVersion("3.1.1");

        this.attachEventHandlers();

        this.connect();
    }

    private attachEventHandlers() {
        this.error.on((error) => {
            console.log("unrelated error: ", error);
            // TODO(jroesch): We should have a mechanism for asking to report errors like this directly to the mode.
        });

        // When attaching event handlers ensure the global error log is clear.
        stderrOutput = stderrOutput || vscode.window.createOutputChannel("Lean: Server Errors");
        stderrOutput.clear();

        this.error.on((e) => {
            switch (e.error) {
                case 'stderr':
                    stderrOutput.append(e.chunk);
                    stderrOutput.show();
                    break;
                case 'connect':
                    vscode.window.showErrorMessage(
                        `Lean: ${e.message}\n` +
                        'The lean.executablePath may be incorrect, make sure it is a valid Lean executable',
                        'Restart server'
                    ).then((item) => {
                        if (item === 'Restart server') {
                            this.restart();
                        }
                    });
                    break;
                case 'unrelated':
                    vscode.window.showWarningMessage("Lean: " + e.message);
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

        this.tasks.on((curTasks) =>
            this.statusChanged.input({
                isRunning: curTasks.is_running,
                numberOfTasks: curTasks.tasks.length,
                stopped: false,
                tasks: curTasks.tasks,
            }, curTasks.tasks.length == 0));
    }

    restart() {
        super.restart();
        this.restarted.fire(null);
        stderrOutput.appendLine("----- user triggered restart -----");
    }
};

export { Server };
