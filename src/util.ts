import { Event, EventEmitter, Position, TextDocument } from 'vscode';

export function isInputCompletion(document: TextDocument, position: Position): boolean {
    const text = document.getText();
    let offset = document.offsetAt(position);
    do { offset--; } while (/[^\\\s]/.test(text.charAt(offset)));
    return text.charAt(offset) === '\\';
}

export class LowPassFilter<T> {
    constructor(public delayms: number) {}

    private emitter = new EventEmitter<T>();
    on: Event<T> = this.emitter.event;

    currentValue: T;

    // scheduledTimer is non-null iff we did not propagate a change yet.
    private scheduledTimer: NodeJS.Timer;

    input(t: T, now?: boolean): void {
        this.currentValue = t;
        if (!this.scheduledTimer) {
            this.scheduledTimer =
                setTimeout(() => this.updateNow(), this.delayms);
        }
        if (now) { this.updateNow(); }
    }

    updateNow(): void {
        if (this.scheduledTimer) {
            this.scheduledTimer = null;
            this.emitter.fire(this.currentValue);
        }
    }
}
