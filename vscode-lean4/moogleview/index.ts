import { AbbreviationConfig } from '@leanprover/unicode-input'
import { InputAbbreviationRewriter } from '@leanprover/unicode-input-component'

const vscodeApi = acquireVsCodeApi()

interface MoogleHit {
    id: string
    displayHtml: string
    sourceCodeUrl: string
    mathlibPath: string
    moduleImports: string[]
    moduleDocstring: string
    declarationDocstring: string
    declarationName: string
    declarationCode: string
    declarationType: string
}

interface MoogleQueryResponse {
    data: MoogleHit[]
    error?: string
    header?: string
}

class MoogleQueryHistory {
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

function getScriptArg(name: string): string {
    return document.querySelector('script[data-id="moogleview-script"]')!.getAttribute(name)!
}

class MoogleView {
    private queryInput = document.getElementById('query-text-field')!
    private findButton = document.getElementById('find-button')!
    private previousQueryButton = document.getElementById('previous-query-button')!
    private nextQueryButton = document.getElementById('next-query-button')!
    private closeTabTrigger = document.getElementById('close-tab')!
    private header = document.getElementById('header')!
    private error = document.getElementById('error')!
    private resultHeader = document.getElementById('result-header')!
    private results = document.getElementById('results')!
    private spinner = document.getElementById('spinner')!

    private history: MoogleQueryHistory = new MoogleQueryHistory()
    private abbreviationConfig: AbbreviationConfig = JSON.parse(getScriptArg('abbreviation-config'))

    private vscodeVersion: string = getScriptArg('vscode-version')
    private extensionVersion: string = getScriptArg('extension-version')

    private rewriter: InputAbbreviationRewriter = new InputAbbreviationRewriter(
        this.abbreviationConfig,
        this.queryInput,
    )

    static initialize(): MoogleView {
        const view = new MoogleView()

        view.findButton.addEventListener('click', async () => {
            await view.runMoogleQuery(view.queryInput.innerText)
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

    private async runMoogleQuery(query: string) {
        this.history.add(query)
        const response: MoogleQueryResponse = await this.withSpinner(async () => {
            try {
                const headers = new Headers({
                    'User-Agent': `Code/${this.vscodeVersion} lean4/${this.extensionVersion}`,
                    accept: '*/*',
                    'content-type': 'application/json',
                })
                const moogle_url =
                    'https://morph-cors-anywhere.pranavnt.workers.dev/?' + 'https://www.moogle.ai/api/search'

                const result = await fetch(moogle_url, {
                    headers,
                    body: JSON.stringify([{ isFind: false, contents: query }]),
                    method: 'POST',
                })

                return await result.json()
            } catch (e) {
                this.displayError(`Cannot fetch Moogle data: ${e}`)
                return undefined
            }
        })
        if (response === undefined) {
            return
        }

        response.data = response.data ?? []
        response.error = response.error ?? ''
        response.header = response.header ?? ''

        this.displayHeader(response.header)
        this.displayError(response.error)
        this.displayResults(response.data)
    }

    private displayHeader(headerText: string) {
        this.header.hidden = headerText.length === 0
        this.header.innerText = headerText
    }

    private displayError(errorText: string) {
        this.error.hidden = errorText.length === 0
        this.error.innerText = errorText
    }

    private displayResults(hits: MoogleHit[]) {
        this.resultHeader.hidden = hits.length === 0
        this.results.innerHTML = '' // Clear previous results

        if (hits.length === 0) {
            this.results.innerHTML = '<p>No results found.</p>'
            return
        }

        hits.forEach((hit, index) => {
            const resultElement = document.createElement('div')
            resultElement.className = 'result-item'

            // Create a temporary element to parse the HTML string
            const tempElement = document.createElement('div')
            tempElement.innerHTML = hit.displayHtml

            // Modify links in the parsed content
            const links = tempElement.getElementsByTagName('a')
            Array.from(links).forEach(link => {
                link.setAttribute(
                    'href',
                    `command:simpleBrowser.show?${encodeURIComponent(JSON.stringify([link.href]))}`,
                )
            })

            // Get the modified HTML content
            const modifiedHtmlContent = tempElement.innerHTML
            const declarationDocstring = hit.declarationDocstring

            resultElement.innerHTML = `
            <div class="result-header">
                <h3>${hit.declarationName}</h3>
            </div>
            <div class="result-content">
                ${declarationDocstring ? `<div class="display-html-container">${declarationDocstring}</div>` : ''}
                <div class="display-html-container">${modifiedHtmlContent}</div>
                <a href="${hit.sourceCodeUrl}">View source code</a>
            </div>
            `

            this.results.appendChild(resultElement)

            const header = resultElement.querySelector('.result-header')
            const content = resultElement.querySelector('.result-content')

            // Open the first result by default
            if (index === 0) {
                content?.classList.add('open')
            }

            header?.addEventListener('click', () => {
                content?.classList.toggle('open')
            })
        })
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
    MoogleView.initialize()
} else {
    const observer = new MutationObserver(_ => {
        if (document.getElementById('query-text-field')) {
            observer.disconnect()
            MoogleView.initialize()
        }
    })
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    })
}
