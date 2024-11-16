import { AbbreviationConfig } from '@leanprover/unicode-input'
import { InputAbbreviationRewriter } from '@leanprover/unicode-input-component'

const vscodeApi = acquireVsCodeApi()

interface BaseHit {
    id: string
    displayHtml: string
}

interface TheoremHit extends BaseHit {
    title: string
    theorem: string
    metadata: {
        mathlib_path: string
        declaration_name: string
        declaration_type: string
        declaration_code: string
        module_docstring: string
        declaration_docstring: string
        fully_qualified_name: string
        source_code_url: string
        display_html: string
        module_imports: {
            url: string
            name: string
        }[]
        commit_hash: string
    }
}

interface DocHit extends BaseHit {
    title: string
    textbook: string
    content?: string
    displayHTML?: string
}

type MoogleHit = TheoremHit | DocHit

type TheoremResponse = TheoremHit[]
type DocResponse = DocHit[]

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
    private error = document.getElementById('error')!
    private resultHeader = document.getElementById('result-header')!
    private results = document.getElementById('results')!
    private spinner = document.getElementById('spinner')!
    private searchMode = document.getElementById('mode-toggle') as HTMLInputElement
    private theoremText = document.querySelector('.theorem-text') as HTMLElement
    private docText = document.querySelector('.doc-text') as HTMLElement
    private currentSearchMode: 'theorem' | 'doc' = 'theorem'

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

        view.searchMode.addEventListener('change', (e: Event) => {
            const target = e.target as HTMLInputElement
            view.currentSearchMode = target.checked ? 'doc' : 'theorem'
            view.theoremText.classList.toggle('active', !target.checked)
            view.docText.classList.toggle('active', target.checked)
            view.results.innerHTML = ''
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
        const response = await this.withSpinner(async () => {
            try {
                const headers = new Headers({
                    'User-Agent': `Code/${this.vscodeVersion} lean4/${this.extensionVersion}`,
                    accept: '*/*',
                    'content-type': 'application/json',
                })

                const baseUrl = 'https://morph-cors-anywhere.pranavnt.workers.dev/?https://www.moogle.ai/api'

                if (this.currentSearchMode === 'theorem') {
                    const result = await fetch(`${baseUrl}/moogle2?query=${query}`, {
                        headers,
                        method: 'GET',
                    })
                    const hits: TheoremResponse = await result.json()
                    const theoremHits = hits.map(hit => ({ ...hit, displayHtml: hit.metadata.display_html }))
                    return { data: theoremHits }
                } else {
                    const params = new URLSearchParams({ query })
                    const result = await fetch(`${baseUrl}/docSearch?${params}`, {
                        headers,
                        method: 'GET',
                    })
                    const hits: DocResponse = await result.json()
                    return { data: hits }
                }
            } catch (e) {
                this.displayError(`Cannot fetch Moogle data: ${e}`)
                return undefined
            }
        })

        if (response === undefined) return

        this.displayResults(response.data ?? [])
    }

    private displayError(errorText: string) {
        this.error.hidden = errorText.length === 0
        this.error.innerText = errorText
    }

    private displayResults(hits: MoogleHit[]) {
        this.resultHeader.hidden = hits.length === 0
        this.results.innerHTML = ''

        if (hits.length === 0) {
            this.results.innerHTML = '<p>No results found.</p>'
            return
        }

        hits.forEach((hit, index) => {
            const resultElement = document.createElement('div')
            resultElement.className = 'result-item'

            if ('metadata' in hit) {
                this.displayTheoremHit(resultElement, hit)
            } else {
                this.displayDocHit(resultElement, hit)
            }

            if (index === 0) {
                resultElement.querySelector('.result-content')?.classList.add('open')
            }

            this.results.appendChild(resultElement)
        })
    }

    private displayTheoremHit(element: HTMLElement, hit: TheoremHit) {
        const tempElement = document.createElement('div')
        tempElement.innerHTML = hit.metadata.display_html

        const links = tempElement.getElementsByTagName('a')
        Array.from(links).forEach(link => {
            link.setAttribute('href', `command:simpleBrowser.show?${encodeURIComponent(JSON.stringify([link.href]))}`)
        })

        element.innerHTML = `
            <div class="result-header">
                <h3>${hit.metadata.declaration_name}</h3>
            </div>
            <div class="result-content">
                ${hit.metadata.declaration_docstring ? `<div class="display-html-container">${hit.metadata.declaration_docstring}</div>` : ''}
                <div class="display-html-container">${tempElement.innerHTML}</div>
                <a href="${hit.metadata.source_code_url}">View source code</a>
            </div>
        `

        this.setupResultToggle(element)
    }

    private transformDisplayHTML(input: string): string {
        // Replace <code>lean with <pre><code class="language-lean">
        let result = input.replace(/<code>lean\n/g, '<pre><code class="language-lean">')
        // Replace <code>output info with <pre><code class="language-text">
        result = result.replace(/<code>output info\n/g, '<pre><code class="language-text">')
        // Replace standalone </code> with </code></pre>
        result = result.replace(/<\/code>(?!<\/pre>)/g, '</code></pre>')
        // Replace {{#example_in ...}} and {{#example_out ...}} with placeholders
        result = result.replace(/{{#example_in [\w/.]+}}/g, '<span class="example-in">[Example Input]</span>')
        result = result.replace(/{{#example_out [\w/.]+}}/g, '<span class="example-out">[Example Output]</span>')
        // Replace {{#example_decl ...}} with a placeholder
        result = result.replace(/{{#example_decl [\w/.]+}}/g, '<span class="example-decl">[Example Declaration]</span>')
        // Replace {{#example_eval ...}} with a placeholder
        result = result.replace(/{{#example_eval [\w/.]+}}/g, '<span class="example-eval">[Example Evaluation]</span>')
        // Remove any remaining newline character immediately after opening <code> tags
        result = result.replace(/<code>(\s*)\n/g, '<code>')
        return result
    }

    private displayDocHit(element: HTMLElement, hit: DocHit) {
        const modifiedHtmlContent = this.transformDisplayHTML(hit.displayHTML ?? '')
        element.innerHTML = `
            <div class="result-header">
                <h3>${hit.title}</h3>
            </div>
            <div class="result-content">
                <a href="${hit.textbook}">View online</a>
                <div class="display-html-container">${modifiedHtmlContent}</div>
            </div>
        `

        // Add Lean syntax highlighting
        element.querySelectorAll('code.language-lean').forEach(block => {
            const code = block.innerHTML
            block.innerHTML = code
                .replace(/\b(def|fun|let|structure|where|match|with|Type|class)\b/g, '<span class="keyword">$1</span>')
                .replace(/\b(Nat|String|Bool|List|Option|Type)\b/g, '<span class="type">$1</span>')
                .replace(/(:=|-&gt;|→|←|↔|⟹|⟸|⟺)/g, '<span class="symbol">$1</span>')
        })

        this.setupResultToggle(element)
    }

    private setupResultToggle(element: HTMLElement) {
        const header = element.querySelector('.result-header')
        const content = element.querySelector('.result-content')

        header?.addEventListener('click', () => {
            content?.classList.toggle('open')
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
