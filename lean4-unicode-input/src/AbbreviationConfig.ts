export interface SymbolsByAbbreviation {
    [abbrev: string]: string
}

export interface AbbreviationConfig {
    abbreviationCharacter: string
    customTranslations: SymbolsByAbbreviation
    eagerReplacementEnabled: boolean
}
