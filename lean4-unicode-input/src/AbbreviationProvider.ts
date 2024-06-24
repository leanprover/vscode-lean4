import { AbbreviationConfig, SymbolsByAbbreviation } from './AbbreviationConfig'
import abbreviations from './abbreviations'

/**
 * Answers queries to a database of abbreviations.
 */
export class AbbreviationProvider {
    private replacementTextCache: Record<string, string | undefined> = {}
    private symbolsByAbbreviation: SymbolsByAbbreviation = {}

    constructor(readonly config: AbbreviationConfig) {
        this.symbolsByAbbreviation = {
            ...abbreviations,
            ...this.config.customTranslations,
        }
    }

    getSymbolsByAbbreviation(): SymbolsByAbbreviation {
        return this.symbolsByAbbreviation
    }

    collectAllAbbreviations(symbol: string): string[] {
        return Object.entries(this.symbolsByAbbreviation)
            .filter(([abbr, sym]) => sym === symbol)
            .map(([abbr]) => abbr)
    }

    findAutoClosingAbbreviations(openingSymbol: string): [string, string][] {
        return Object.entries(this.symbolsByAbbreviation)
            .filter(([_, sym]) => sym.startsWith(`${openingSymbol}$CURSOR`))
            .map(([abbr, sym]) => [abbr, sym.replace(`${openingSymbol}$CURSOR`, '')])
    }

    findSymbolsIn(symbolPlusUnknown: string): string[] {
        const result = new Set<string>()
        for (const [abbr, sym] of Object.entries(this.symbolsByAbbreviation)) {
            if (symbolPlusUnknown.startsWith(sym)) {
                result.add(sym)
            }
        }
        return [...result.values()]
    }

    /**
     * Computes the replacement text for a typed abbreviation (excl. leader).
     * This converts the longest non-empty prefix with the best-matching abbreviation.
     *
     * For example:
     *   getReplacementText("alp") returns "α"
     *   getReplacementText("alp7") returns "α7"
     *   getReplacementText("") returns undefined
     */
    getReplacementText(abbrev: string): string | undefined {
        if (abbrev in this.replacementTextCache) {
            return this.replacementTextCache[abbrev]
        }
        const result = this.findReplacementText(abbrev)
        this.replacementTextCache[abbrev] = result
        return result
    }

    private findReplacementText(abbrev: string): string | undefined {
        if (abbrev.length === 0) {
            return undefined
        }

        const matchingSymbol = this.findSymbolsByAbbreviationPrefix(abbrev)[0]
        if (matchingSymbol) {
            return matchingSymbol
        }

        // Convert the `alp` in `\alp7`
        const prefixReplacement = this.getReplacementText(abbrev.slice(0, abbrev.length - 1))
        if (prefixReplacement) {
            return prefixReplacement + abbrev.slice(abbrev.length - 1)
        }

        return undefined
    }

    getSymbolForAbbreviation(abbrev: string): string | undefined {
        return this.symbolsByAbbreviation[abbrev]
    }

    findSymbolsByAbbreviationPrefix(abbrevPrefix: string): string[] {
        const matchingAbbreviations = Object.keys(this.symbolsByAbbreviation).filter(abbrev =>
            abbrev.startsWith(abbrevPrefix),
        )

        matchingAbbreviations.sort((a, b) => a.length - b.length)
        return matchingAbbreviations.map(abbr => this.symbolsByAbbreviation[abbr]!)
    }
}
