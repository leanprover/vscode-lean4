import { AbbreviationConfig } from '@leanprover/unicode-input'
import { InputAbbreviationRewriter } from '@leanprover/unicode-input-component'
import { provideVSCodeDesignSystem, vsCodeButton, vsCodeLink, vsCodeTextField } from '@vscode/webview-ui-toolkit'

provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeTextField(), vsCodeLink())

const vscodeApi = acquireVsCodeApi()

interface LoogleHit {
    name: string
    module: string
    type: string
    doc: string
}

interface LoogleQueryResponse {
    hits?: LoogleHit[] | undefined
    error?: string | undefined
    suggestions?: string[] | undefined
    heartbeats?: number | undefined
    header?: string | undefined
    count?: number | undefined
}

class LoogleQueryHistory {
    private history: string[] = []
    private historyIdx: number = 0

    isDuplicate(query: string) {
        return this.history.length > 0 && this.history[this.history.length - 1] === query
    }

    add(query: string) {
        if (this.isDuplicate(query) || !query) {
            return
        }
        this.history.push(query)
        this.historyIdx = this.history.length
    }

    previousQuery(currentQuery: string): string {
        if (this.historyIdx === this.history.length && currentQuery) {
            if (this.isDuplicate(currentQuery)) {
                this.historyIdx--
            } else {
                this.history.push(currentQuery)
            }
        }
        if (this.historyIdx === -1) {
            return ''
        }
        if (this.historyIdx === 0) {
            this.historyIdx--
            return ''
        }
        this.historyIdx--
        return this.history[this.historyIdx]
    }

    nextQuery(currentQuery: string): string {
        if (this.historyIdx === this.history.length) {
            this.add(currentQuery)
            return ''
        }
        this.historyIdx++
        if (this.historyIdx === this.history.length) {
            return ''
        }
        return this.history[this.historyIdx]
    }
}

class LoogleView {
    private queryInput = document.getElementById('query-text-field')!
    private findButton = document.getElementById('find-button')!
    private previousQueryButton = document.getElementById('previous-query-button')!
    private nextQueryButton = document.getElementById('next-query-button')!
    private closeTabTrigger = document.getElementById('close-tab')!
    private header = document.getElementById('header')!
    private error = document.getElementById('error')!
    private resultHeader = document.getElementById('result-header')!
    private results = document.getElementById('results')!
    private suggestionHeader = document.getElementById('suggestion-header')!
    private suggestions = document.getElementById('suggestions')!
    private spinner = document.getElementById('spinner')!

    private initialQuery = document.querySelector('script[data-id="loogleview-script"]')!.getAttribute('initial-query')
    private staticSuggestions = Array.from(document.getElementsByClassName('query-suggestion'))

    private history: LoogleQueryHistory = new LoogleQueryHistory()
    private abbreviationConfig: AbbreviationConfig = JSON.parse(
        document.currentScript!.getAttribute('abbreviation-config')!,
    )
    private rewriter: InputAbbreviationRewriter = new InputAbbreviationRewriter(
        this.abbreviationConfig,
        this.queryInput,
    )

    static initialize(): LoogleView {
        const view = new LoogleView()

        view.findButton.addEventListener('click', async () => {
            await view.runLoogleQuery(view.queryInput.innerText)
        })

        view.previousQueryButton.addEventListener('click', async () => {
            const previousQuery = view.history.previousQuery(view.queryInput.innerText)
            view.setQuery(previousQuery)
        })

        view.nextQueryButton.addEventListener('click', async () => {
            const nextQuery = view.history.nextQuery(view.queryInput.innerText)
            view.setQuery(nextQuery)
        })

        view.queryInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                view.findButton.click()
                event.preventDefault()
            }
            if (event.key === 'ArrowDown') {
                view.previousQueryButton.click()
                event.preventDefault()
            }
            if (event.key === 'ArrowUp') {
                view.nextQueryButton.click()
                event.preventDefault()
            }
        })

        for (const querySuggestionElement of view.staticSuggestions) {
            if (!(querySuggestionElement instanceof HTMLElement) || querySuggestionElement.tagName !== 'VSCODE-LINK') {
                continue
            }
            const querySuggestion = querySuggestionElement.innerText
            querySuggestionElement.addEventListener('click', () => view.runSuggestion(querySuggestion))
        }

        if (view.initialQuery) {
            view.runSuggestion(view.initialQuery)
        }

        window.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                view.closeTabTrigger.click()
                event.preventDefault()
            }
        })

        view.queryInput.focus()

        return view
    }

    private setQuery(query: string) {
        this.rewriter.resetAbbreviations()
        this.queryInput.innerHTML = query
    }

    private async runLoogleQuery(query: string) {
        this.history.add(query)
        const response: LoogleQueryResponse = await this.withSpinner(async () => {
            try {
                const headers = new Headers({
                    'User-Agent': 'Lean 4 VS Code Extension',
                })
                return await (
                    await fetch(`https://loogle.lean-lang.org/json?q=${encodeURIComponent(query)}`, {
                        headers,
                    })
                ).json()
            } catch (e) {
                this.displayError(`Cannot fetch Loogle data: ${e}`)
                return undefined
            }
        })
        if (response === undefined) {
            return
        }

        response.hits = response.hits ?? []
        response.error = response.error ?? ''
        response.suggestions = response.suggestions ?? []
        response.header = response.header ?? ''

        this.displayHeader(response.header)
        this.displayError(response.error)
        this.displayResults(response.hits)
        this.displaySuggestions(response.suggestions)
    }

    private runSuggestion(querySuggestion: string) {
        this.setQuery(querySuggestion)
        this.findButton.click()
        window.scrollTo(0, 0)
    }

    private createQuerySuggestionNode(querySuggestion: string): HTMLElement {
        const link = document.createElement('vscode-link')
        link.innerText = querySuggestion
        link.addEventListener('click', () => this.runSuggestion(querySuggestion))
        return link
    }

    private createHitNameNode(name: string, module: string): HTMLElement {
        // This is not correct (consider e.g. escaped dots in french quotes) but it should be good enough for now.
        const docUrl = `https://leanprover-community.github.io/mathlib4_docs/${encodeURIComponent(module.replace(new RegExp(/\./, 'g'), '/'))}.html#${encodeURIComponent(name)}`
        const link = document.createElement('vscode-link')
        link.innerText = name
        link.setAttribute('href', `command:simpleBrowser.show?${encodeURIComponent(JSON.stringify([docUrl]))}`)
        return link
    }

    private displayHeader(headerText: string) {
        this.header.hidden = headerText.length === 0
        this.header.innerText = headerText
    }

    private displayError(errorText: string) {
        this.error.hidden = errorText.length === 0
        this.error.innerText = errorText
    }

    private displayResults(hits: LoogleHit[]) {
        this.resultHeader.hidden = hits.length === 0
        const resultNodes = hits.map(hit => {
            const entry = document.createElement('li')
            const identifierNode = document.createElement('span')
            identifierNode.appendChild(this.createHitNameNode(hit.name, hit.module))
            identifierNode.appendChild(document.createTextNode(` @ ${hit.module}`))
            entry.appendChild(identifierNode)
            entry.appendChild(document.createElement('br'))
            entry.appendChild(document.createTextNode(hit.type))
            return entry
        })
        this.results.replaceChildren(...resultNodes)
    }

    private displaySuggestions(suggestions: string[]) {
        this.suggestionHeader.hidden = suggestions.length === 0
        const suggestionNodes = suggestions.map(suggestion => {
            const entry = document.createElement('li')
            entry.appendChild(this.createQuerySuggestionNode(suggestion))
            return entry
        })
        this.suggestions.replaceChildren(...suggestionNodes)
    }

    private async withSpinner<T>(fn: () => Promise<T>): Promise<T> {
        this.spinner.classList.remove('hidden')
        try {
            const r = await fn()
            return r
        } finally {
            this.spinner.classList.add('hidden')
        }
    }
}

if (document.getElementById('query-text-field')) {
    LoogleView.initialize()
} else {
    const observer = new MutationObserver(_ => {
        if (document.getElementById('query-text-field')) {
            observer.disconnect()
            LoogleView.initialize()
        }
    })
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    })
}
