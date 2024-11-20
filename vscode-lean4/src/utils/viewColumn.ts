import { TabInputWebview, ViewColumn, window } from 'vscode'

export function viewColumnOfInfoView(): ViewColumn {
    for (const tabGroup of window.tabGroups.all) {
        const tab = tabGroup.tabs.find(
            tab => tab.input instanceof TabInputWebview && tab.input.viewType === 'mainThreadWebview-lean4_infoview',
        )
        if (tab !== undefined) {
            return tabGroup.viewColumn
        }
    }
    return ViewColumn.Beside
}

export function viewColumnOfActiveTextEditor(): ViewColumn {
    return window.activeTextEditor?.viewColumn ?? ViewColumn.One
}
