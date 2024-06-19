import {
    DataGrid,
    provideVSCodeDesignSystem,
    vsCodeDataGrid,
    vsCodeDataGridCell,
    vsCodeDataGridRow,
} from '@vscode/webview-ui-toolkit'

provideVSCodeDesignSystem().register(vsCodeDataGrid(), vsCodeDataGridRow(), vsCodeDataGridCell())

const abbreviations: { Abbreviation: string; 'Unicode symbol': string } = JSON.parse(
    document.querySelector('script[data-id="abbreviationview-script"]')!.getAttribute('abbreviations')!,
)

const grid = document.getElementById('abbreviation-grid')! as DataGrid

grid.rowsData = abbreviations as any
