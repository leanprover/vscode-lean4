import { StatusBarItem, Disposable, window, StatusBarAlignment } from 'vscode';
import {Server} from './server';
import { RoiManager, RoiMode } from './roi';

export class LeanStatusBarItem implements Disposable {
    statusBarItem: StatusBarItem;
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

        this.update();
        this.statusBarItem.show();
    }

    update() {
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
            case RoiMode.Cursor: text += ' (checking cursor + 5 lines)'; break;
            case RoiMode.VisibleFiles: text += ' (checking visible files)'; break;
            case RoiMode.OpenFiles: text += ' (checking open files)'; break;
            case RoiMode.ProjectFiles: text += ' (checking project files)'; break;
        }

        this.statusBarItem.text = text;
    }

    dispose() {
        this.statusBarItem.dispose();
        for (const s of this.subscriptions) s.dispose();
    }
}