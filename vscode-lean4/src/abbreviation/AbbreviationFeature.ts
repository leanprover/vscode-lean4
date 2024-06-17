import { AbbreviationProvider } from '@leanprover/unicode-input'
import { Disposable, languages } from 'vscode'
import { AbbreviationHoverProvider } from './AbbreviationHoverProvider'
import { AbbreviationRewriterFeature } from './AbbreviationRewriterFeature'
import { VSCodeAbbreviationConfig } from './VSCodeAbbreviationConfig'

export class AbbreviationFeature {
    private readonly disposables = new Array<Disposable>()
    readonly abbreviations: AbbreviationProvider

    constructor() {
        const config = new VSCodeAbbreviationConfig()
        this.disposables.push(config)
        this.abbreviations = new AbbreviationProvider(config)

        this.disposables.push(
            languages.registerHoverProvider(
                config.languages,
                new AbbreviationHoverProvider(config, this.abbreviations),
            ),
            new AbbreviationRewriterFeature(config, this.abbreviations),
        )
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}
