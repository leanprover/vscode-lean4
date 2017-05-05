import * as vscode from 'vscode';
import {Event, Disposable, EventEmitter} from 'vscode'
import * as fs from 'fs';
import * as carrier from 'carrier';
import * as child from 'child_process';
import * as stream from 'stream';
import * as semver from 'semver';

export function getExecutablePath() : string {
   let config = vscode.workspace.getConfiguration('lean');
   let executablePath = config.get('executablePath') as string;
   if (executablePath !== "lean")
       fs.accessSync(executablePath, fs.constants.F_OK);
   return executablePath;
}

export function getMemoryLimit() : number {
   let config = vscode.workspace.getConfiguration('lean');
   let memoryLimit = config.get('memoryLimit') as number;
   return memoryLimit;
}

export function getTimeLimit() : number {
   let config = vscode.workspace.getConfiguration('lean');
   let timeLimit = config.get('timeLimit') as number;
   return timeLimit;
}

export function isInputCompletion(document : vscode.TextDocument, position : vscode.Position) : boolean {
    let text = document.getText();
    let offset = document.offsetAt(position);
    do { offset--; } while (/[^\\\s]/.test(text.charAt(offset)));
    return text.charAt(offset) === '\\';
}

export function getEnv() {
    let env = Object.create(process.env);
    if (process.platform == 'win32') {
        env.Path = `${env.Path};C:\\msys64\\mingw64\\bin;C:\\msys64\\usr\\local\\bin;C:\\msys64\\usr\\bin;C:\\msys64\\bin;C:\\msys64\\opt\\bin;`;
    }
    return env;
}

let LEAN_VERSION : string = null;

function detectVersion() : string {
    let executablePath = getExecutablePath() || "lean";
    let output = child.execSync(`${executablePath} --version`, { env : getEnv() });
    let matchRegex = /Lean \(version ([0-9.]+)/;
    return output.toString().match(matchRegex)[1];
}

export function atLeastLeanVersion(requiredVersion : string) : boolean {
    if (!LEAN_VERSION) {
        LEAN_VERSION = detectVersion();
    }

    return semver.lte(requiredVersion, LEAN_VERSION);
}

export class LowPassFilter<T> {
    constructor(public delayms: number) {}

    private emitter = new EventEmitter<T>();
    on: Event<T> = this.emitter.event;

    currentValue: T;

    // scheduledTimer is non-null iff we did not propagate a change yet.
    private scheduledTimer: NodeJS.Timer;

    input(t: T, now?: boolean) {
        this.currentValue = t;
        if (!this.scheduledTimer) {
            this.scheduledTimer =
                setTimeout(() => this.updateNow(), this.delayms);
        }
        if (now) this.updateNow();
    }

    updateNow() {
        if (this.scheduledTimer) {
            this.scheduledTimer = null;
            this.emitter.fire(this.currentValue);
        }
    }
}