import {
    CancellationToken,
    Disposable,
    LanguageModelTextPart,
    LanguageModelTool,
    LanguageModelToolInvocationOptions,
    LanguageModelToolInvocationPrepareOptions,
    LanguageModelToolResult,
    languages,
    lm,
    PreparedToolInvocation,
    Uri,
    workspace,
} from 'vscode'
import { LeanClient } from './leanclient'
import { LeanClientProvider } from './utils/clientProvider'
import { ExtUri, toExtUri } from './utils/exturi'
import { lean, LeanDocument } from './utils/leanEditorProvider'
import { logger } from './utils/logger'

/** Name of the tool. Must match the `name` of the `languageModelTools` contribution in `package.json`. */
const leanWaitForDiagnosticsToolName = 'lean4_waitForDiagnostics'

/** Upper bound on how long we wait for the server to finish processing a single file. */
const waitForDiagnosticsTimeoutMs = 5 * 60 * 1000

/**
 * Substring of the diagnostic that the Lean server emits on a file whose imports are out of date
 * (both for the `information`-severity sticky diagnostic of recent servers and the older
 * `error`-severity variant).
 */
const importsOutOfDateMarker = 'Imports are out of date'

type RefreshImportsMode = 'auto' | 'always' | 'never'

interface LeanWaitForDiagnosticsToolInput {
    files?: string[]
    refreshImports?: RefreshImportsMode
}

interface WaitTarget {
    extUri: ExtUri
    displayPath: string
    doc: LeanDocument | undefined
    client: LeanClient | undefined
}

/**
 * A VS Code language model tool that waits until the Lean language server has produced up-to-date
 * diagnostics for one or more files. It is meant to be called right before a generic diagnostics
 * tool (such as `get_errors`), which reads whatever diagnostics are currently published without
 * waiting. This tool addresses two problems that such generic tools run into with Lean:
 *
 * 1. Elaboration is asynchronous, so diagnostics may still be incomplete right after an edit. The
 *    tool sends `textDocument/waitForDiagnostics`, which the server only answers once it has
 *    finished processing the file at the current document version.
 * 2. A file worker loads its imports once at startup, so a file that imports an edited file keeps
 *    reporting stale diagnostics until it is restarted. The tool detects the server's "imports are
 *    out of date" diagnostic and restarts the affected file (rebuilding its imports) before waiting
 *    again.
 */
export class LeanWaitForDiagnosticsTool implements LanguageModelTool<LeanWaitForDiagnosticsToolInput> {
    constructor(private readonly clientProvider: LeanClientProvider) {}

    prepareInvocation(
        _options: LanguageModelToolInvocationPrepareOptions<LeanWaitForDiagnosticsToolInput>,
        _token: CancellationToken,
    ): PreparedToolInvocation {
        return { invocationMessage: 'Waiting for Lean to finish processing' }
    }

    async invoke(
        options: LanguageModelToolInvocationOptions<LeanWaitForDiagnosticsToolInput>,
        token: CancellationToken,
    ): Promise<LanguageModelToolResult> {
        const refreshImports: RefreshImportsMode = options.input.refreshImports ?? 'auto'
        const { targets, skipped } = await this.resolveTargets(options.input.files)
        if (targets.length === 0 && skipped.length === 0) {
            return textResult('No Lean files found to wait for.')
        }

        const statuses = await Promise.all(targets.map(target => this.processTarget(target, refreshImports, token)))
        const skippedStatuses = skipped.map(file => `${file}: unsupported URI scheme; skipped.`)
        const lines = [...statuses, ...skippedStatuses]
        const header =
            'Lean has finished processing the requested file(s). Read the up-to-date errors and warnings with your usual diagnostics tool (e.g. get_errors).'
        return textResult(`${header}\n\n${lines.join('\n')}`)
    }

    private async resolveTargets(files: string[] | undefined): Promise<{ targets: WaitTarget[]; skipped: string[] }> {
        if (files === undefined || files.length === 0) {
            return { targets: lean.leanDocuments.map(doc => this.toTarget(doc.extUri, doc)), skipped: [] }
        }

        const targets: WaitTarget[] = []
        const skipped: string[] = []
        for (const file of files) {
            const extUri = toExtUri(parseInputUri(file))
            if (extUri === undefined) {
                skipped.push(file)
                continue
            }

            let doc = lean.getLeanDocumentByUri(extUri)
            if (doc === undefined) {
                // Open the document so that the language server starts checking it, and so that we can
                // restart it later if its imports turn out to be stale.
                try {
                    const textDocument = await workspace.openTextDocument(extUri.asUri())
                    doc = new LeanDocument(textDocument, extUri)
                } catch {
                    doc = undefined
                }
            }
            targets.push(this.toTarget(extUri, doc))
        }
        return { targets, skipped }
    }

    private toTarget(extUri: ExtUri, doc: LeanDocument | undefined): WaitTarget {
        return {
            extUri,
            displayPath: extUri.scheme === 'file' ? extUri.fsPath : extUri.toString(),
            doc,
            client: this.clientProvider.findClient(extUri),
        }
    }

    private async processTarget(
        target: WaitTarget,
        refreshImports: RefreshImportsMode,
        token: CancellationToken,
    ): Promise<string> {
        const { extUri, displayPath, doc, client } = target
        if (client === undefined || !client.isRunning()) {
            return `${displayPath}: no running Lean server manages this file.`
        }
        if (doc === undefined) {
            return `${displayPath}: could not open the file, so it could not be checked.`
        }
        const version = doc.doc.version

        if (refreshImports === 'always') {
            await client.restartFile(doc)
            const wait = await client.waitForDiagnostics(extUri, version, waitForDiagnosticsTimeoutMs, token)
            return statusLine(displayPath, wait, true)
        }

        const firstWait = await client.waitForDiagnostics(extUri, version, waitForDiagnosticsTimeoutMs, token)
        if (firstWait !== 'Completed') {
            return statusLine(displayPath, firstWait, false)
        }

        if (refreshImports === 'auto' && hasStaleImports(extUri)) {
            await client.restartFile(doc)
            const secondWait = await client.waitForDiagnostics(extUri, version, waitForDiagnosticsTimeoutMs, token)
            return statusLine(displayPath, secondWait, true)
        }

        return statusLine(displayPath, 'Completed', false)
    }
}

/** Registers the Lean wait-for-diagnostics language model tool, if the current VS Code version supports it. */
export function registerLeanWaitForDiagnosticsTool(clientProvider: LeanClientProvider): Disposable {
    if (typeof lm?.registerTool !== 'function') {
        logger.log(
            '[LanguageModelTools] `vscode.lm.registerTool` is unavailable; Lean wait-for-diagnostics tool not registered.',
        )
        return { dispose: () => {} }
    }
    return lm.registerTool(leanWaitForDiagnosticsToolName, new LeanWaitForDiagnosticsTool(clientProvider))
}

function statusLine(
    displayPath: string,
    result: 'Completed' | 'TimedOut' | 'Cancelled' | 'Stopped',
    refreshedImports: boolean,
): string {
    switch (result) {
        case 'Completed':
            return refreshedImports ? `${displayPath}: imports rebuilt, ready.` : `${displayPath}: ready.`
        case 'TimedOut':
            return `${displayPath}: timed out; diagnostics may still be incomplete.`
        case 'Cancelled':
            return `${displayPath}: cancelled.`
        case 'Stopped':
            return `${displayPath}: the Lean server stopped before finishing.`
    }
}

function parseInputUri(file: string): Uri {
    // Only treat inputs with a known editor scheme as URIs; everything else (including Windows paths
    // like `C:\...`) is treated as a file system path.
    if (/^(file|untitled|vscode-vfs|vscode-remote|vscode-userdata):/.test(file)) {
        return Uri.parse(file)
    }
    return Uri.file(file)
}

function hasStaleImports(extUri: ExtUri): boolean {
    return languages
        .getDiagnostics(extUri.asUri())
        .some(d => d.range.start.line === 0 && d.message.includes(importsOutOfDateMarker))
}

function textResult(text: string): LanguageModelToolResult {
    return new LanguageModelToolResult([new LanguageModelTextPart(text)])
}
