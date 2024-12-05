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

    // We do not use `ViewColumn.Beside` here because `ViewColumn.Beside` will never
    // add a tab to a locked tab group.
    // This is especially problematic because locking the tab group of the InfoView
    // is a workaround for https://github.com/microsoft/vscode/issues/212679
    // and using `ViewColumn.Beside` will retain an empty locked tab group when restarting VS Code.
    const activeColumn = window.activeTextEditor?.viewColumn
    if (activeColumn === undefined) {
        return ViewColumn.Two
    }
    return activeColumn + 1
}

export function viewColumnOfActiveTextEditor(): ViewColumn {
    return window.activeTextEditor?.viewColumn ?? ViewColumn.One
}
