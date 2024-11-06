const abbreviations: { Abbreviation: string; 'Unicode symbol': string }[] = JSON.parse(
    document.querySelector('script[data-id="abbreviationview-script"]')!.getAttribute('abbreviations')!,
)

const tableBody = document.getElementById('abbreviation-table')!

for (const { Abbreviation: abbr, 'Unicode symbol': symb } of abbreviations) {
    const row = document.createElement('vscode-table-row')
    const abbrCell = document.createElement('vscode-table-cell')
    abbrCell.innerText = abbr
    row.appendChild(abbrCell)
    const symbCell = document.createElement('vscode-table-cell')
    symbCell.innerText = symb
    row.appendChild(symbCell)
    tableBody.appendChild(row)
}
