import { Disposable, languages } from 'vscode'
import { autorunDisposable } from '../utils/autorunDisposable'
import { AbbreviationHoverProvider } from './AbbreviationHoverProvider'
import { AbbreviationProvider } from './AbbreviationProvider'
import { AbbreviationConfig } from './config'
import { AbbreviationRewriterFeature } from './rewriter/AbbreviationRewriterFeature'

export class AbbreviationFeature {
    private readonly disposables = new Array<Disposable>()
    readonly abbreviations: AbbreviationProvider

    constructor() {
        const config = new AbbreviationConfig()
        this.abbreviations = new AbbreviationProvider(config)

        this.disposables.push(
            autorunDisposable(disposables => {
                disposables.push(
                    languages.registerHoverProvider(
                        config.languages.get(),
                        new AbbreviationHoverProvider(config, this.abbreviations),
                    ),
                )
            }),
            new AbbreviationRewriterFeature(config, this.abbreviations),
        )
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose()
        }
    }
}
