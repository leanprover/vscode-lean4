import { AbbreviationProvider } from '@leanprover/unicode-input'
import { Disposable, OutputChannel, languages } from 'vscode'
import { AbbreviationHoverProvider } from './AbbreviationHoverProvider'
import { AbbreviationRewriterFeature } from './AbbreviationRewriterFeature'
import { VSCodeAbbreviationConfig } from './VSCodeAbbreviationConfig'
import { SelectionMoveMode } from '@leanprover/unicode-input'

export class AbbreviationFeature {
    private readonly disposables = new Array<Disposable>()
    readonly abbreviations: AbbreviationProvider

    constructor(outputChannel: OutputChannel, selectionMoveMove?: SelectionMoveMode) {
        const config = new VSCodeAbbreviationConfig()
        this.disposables.push(config)
        this.abbreviations = new AbbreviationProvider(config)

        this.disposables.push(
            languages.registerHoverProvider(
                config.languages,
                new AbbreviationHoverProvider(config, this.abbreviations),
            ),
            new AbbreviationRewriterFeature(config, this.abbreviations, outputChannel, selectionMoveMove),
        )
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}
