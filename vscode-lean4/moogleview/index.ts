import { AbbreviationConfig } from '@leanprover/unicode-input'
import { InputAbbreviationRewriter } from '@leanprover/unicode-input-component'

const vscodeApi = acquireVsCodeApi()

interface TheoremHit {
    id: string
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

interface DocHit {
    id: string
    title: string
    textbook: string
    content?: string
    displayHTML?: string
}

type MoogleHit = TheoremHit | DocHit

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
    private theoremText = document.getElementById('theorem-text')!
    private docText = document.getElementById('doc-text')!
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

                const baseUrl = 'https://www.moogle.ai/api'
                const encodedQuery = encodeURIComponent(query)

                if (this.currentSearchMode === 'theorem') {
                    const result = await fetch(`${baseUrl}/moogle2?query=${encodedQuery}`, {
                        headers,
                        method: 'GET',
                    })
                    const data = await result.json()
                    if (!Array.isArray(data)) {
                        this.displayError('Invalid response from server')
                        return undefined
                    }
                    const theoremHits = data.map(hit => ({ ...hit, displayHtml: hit.metadata.display_html }))
                    return { data: theoremHits }
                } else {
                    const result = await fetch(`${baseUrl}/docSearch?query=${encodedQuery}`, {
                        headers,
                        method: 'GET',
                    })
                    const hits: DocHit[] = await result.json()
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
        this.displayError('')

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
                ${
                    hit.metadata.declaration_docstring
                        ? `<div class="display-html-container doc-text">${hit.metadata.declaration_docstring}</div>`
                        : ''
                }
                <div class="display-html-container code-text">${tempElement.innerHTML}</div>
                <a href="${hit.metadata.source_code_url}">View source code</a>
            </div>
        `

        this.setupResultToggle(element)
    }

    private transformMarkdownToHTML(markdown: string, hit?: DocHit): string {
        if (!markdown) return ''

        const isTheoremProving = hit?.textbook?.includes('theorem_proving_in_lean4')

        const tokens: { type: 'code' | 'text'; content: string }[] = []
        let lastIndex = 0
        let match

        // Updated regex to capture the first line separately
        const codeBlockRegex = /```(?:.*)\n([\s\S]*?)```/g

        while ((match = codeBlockRegex.exec(markdown)) !== null) {
            if (match.index > lastIndex) {
                tokens.push({
                    type: 'text',
                    content: markdown.slice(lastIndex, match.index),
                })
            }

            tokens.push({
                type: 'code',
                // Only use the content after the first line
                content: match[1],
            })

            lastIndex = match.index + match[0].length
        }

        if (lastIndex < markdown.length) {
            tokens.push({
                type: 'text',
                content: markdown.slice(lastIndex),
            })
        }

        const processed = tokens.map(token => {
            if (token.type === 'code') {
                return `<pre><code style="color: black !important; background: transparent !important; font-family: var(--vscode-editor-font-family); white-space: pre;">${token.content}</code></pre>`
            } else {
                let html = token.content

                html = html.replace(/\[(.*?)\]\(.*?\)/g, '$1')

                if (isTheoremProving) {
                    html = html.replace(
                        /``([^`]+)``/g,
                        '<code style="color: black !important; background: transparent !important; font-family: var(--vscode-editor-font-family);">$1</code>',
                    )
                }

                html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')

                html = html.replace(
                    /`([^`]+)`/g,
                    '<code style="color: black !important; background: transparent !important; font-family: var(--vscode-editor-font-family);">$1</code>',
                )

                html = html.replace(/^###### (.*$)/gm, '<h6>$1</h6>')
                html = html.replace(/^##### (.*$)/gm, '<h5>$1</h5>')
                html = html.replace(/^#### (.*$)/gm, '<h4>$1</h4>')
                html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
                html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
                html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')

                html = html.replace(/^\s*[-*]\s+(.*)/gm, '<li>$1</li>')
                html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

                html = html
                    .split(/\n\n+/)
                    .map(para => (para.trim() && !para.startsWith('<') ? `<p>${para.trim()}</p>` : para))
                    .join('\n')

                return html
            }
        })

        return processed.join('')
    }

    private displayDocHit(element: HTMLElement, hit: DocHit) {
        const htmlContent = this.transformMarkdownToHTML(hit.content ?? '', hit)
        element.innerHTML = `
            <div class="result-header">
                <h3>${hit.title} <span class="doc-source">(${this.getStringTextbook(hit.textbook)})</span></h3>
            </div>
            <div class="result-content">
                <a href="${hit.textbook}">View online</a>
                <div class="display-html-container">${htmlContent}</div>
            </div>
        `

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

    private getStringTextbook(url: string): string {
        if (url.includes('functional_programming_in_lean')) {
            return 'Functional Programming in Lean'
        } else if (url.includes('theorem_proving_in_lean4')) {
            return 'Theorem Proving in Lean 4'
        } else if (url.includes('type_checking_in_lean4')) {
            return 'Type Checking in Lean 4'
        } else if (url.includes('lean4-metaprogramming-book')) {
            return 'Lean 4 Metaprogramming'
        }
        return ''
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
