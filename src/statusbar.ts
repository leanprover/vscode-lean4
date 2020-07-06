import { Disposable, StatusBarAlignment, StatusBarItem, window } from 'vscode';
import { RoiManager, RoiMode } from './roi';
import { Server } from './server';

export class LeanStatusBarItem implements Disposable {
    statusBarItem: StatusBarItem;
    private shown: boolean = false;

    private subscriptions: Disposable[] = [];

    constructor(private server: Server, private roiManager: RoiManager) {
        this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 10);

        this.subscriptions.push(
            server.restarted.on(() => this.update()),
            server.statusChanged.on(() => this.update()),
        );
        if (roiManager) {
            this.subscriptions.push(roiManager.onModeChanged(() => this.update()));
            this.statusBarItem.command = 'lean.roiMode.select';
        }

        if (this.server.alive()) {
            this.update();
        }
    }

    update(): void {
        let text = 'Lean: ';

        const serverStatus = this.server.statusChanged.currentValue;
        if (serverStatus && serverStatus.isRunning) {
            text += `$(sync) ${serverStatus.numberOfTasks}`;
        } else if (serverStatus && serverStatus.stopped) {
            text += '$(x)';
        } else {
            text += '$(check)';
        }

        switch (this.roiManager && this.roiManager.mode) {
            case RoiMode.Nothing: text += ' (checking nothing)'; break;
            case RoiMode.VisibleLines: text += ' (checking visible lines)'; break;
            case RoiMode.VisibleLinesAndAbove: text += ' (checking visible lines and above)'; break;
            case RoiMode.VisibleFiles: text += ' (checking visible files)'; break;
            case RoiMode.OpenFiles: text += ' (checking open files)'; break;
            case RoiMode.ProjectFiles: text += ' (checking project files)'; break;
        }

        if (!this.shown) {
            this.statusBarItem.show();
            this.shown = true;
        }
        this.statusBarItem.text = text;
    }

    dispose(): void {
        this.statusBarItem.dispose();
        for (const s of this.subscriptions) { s.dispose(); }
    }
}
