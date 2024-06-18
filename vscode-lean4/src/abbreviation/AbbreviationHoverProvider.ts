import { AbbreviationConfig, AbbreviationProvider } from '@leanprover/unicode-input'
import { Hover, HoverProvider, Position, Range, TextDocument } from 'vscode'

/**
 * Adds hover behaviour for getting translations of unicode characters.
 * Eg: "Type ⊓ using \glb or \sqcap"
 */
export class AbbreviationHoverProvider implements HoverProvider {
    constructor(
        private readonly config: AbbreviationConfig,
        private readonly abbreviations: AbbreviationProvider,
    ) {}

    provideHover(document: TextDocument, pos: Position): Hover | undefined {
        const context = document.lineAt(pos.line).text.substr(pos.character)
        const symbolsAtCursor = this.abbreviations.findSymbolsIn(context)
        const allAbbrevs = symbolsAtCursor.map(symbol => ({
            symbol,
            abbrevs: this.abbreviations.collectAllAbbreviations(symbol),
        }))

        if (allAbbrevs.length === 0 || allAbbrevs.every(a => a.abbrevs.length === 0)) {
            return undefined
        }

        const leader = this.config.abbreviationCharacter

        const hoverMarkdown = allAbbrevs
            .map(({ symbol, abbrevs }) => {
                const abbrevInfo = `Type ${symbol} using ${abbrevs.map(a => '`' + leader + a + '`').join(' or ')}`
                const autoClosingAbbrevs = this.abbreviations.findAutoClosingAbbreviations(symbol)
                const autoClosingInfo =
                    autoClosingAbbrevs.length === 0
                        ? ''
                        : `. ${symbol} can be auto-closed with ${autoClosingAbbrevs
                              .map(([a, closingSym]) => `${closingSym} using \`${leader}${a}\``)
                              .join(' or ')}.`
                return abbrevInfo + autoClosingInfo
            })
            .join('\n\n')

        const maxSymbolLength = Math.max(...allAbbrevs.map(a => a.symbol.length))
        const hoverRange = new Range(pos, pos.translate(0, maxSymbolLength))

        return new Hover(hoverMarkdown, hoverRange)
    }
}
