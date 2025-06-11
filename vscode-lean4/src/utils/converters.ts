/**
 * For LSP communication, we need a way to translate between LSP types and corresponding VSCode types.
 * By default this translation is provided as a bunch of methods on a `LanguageClient`, but this is
 * awkward to use in multi-client workspaces wherein we need to look up specific clients. In fact the
 * conversions are *not* stateful, so having them depend on the client is unnecessary. Instead, we
 * provide global converters here.
 *
 * Some of the conversions are patched to support extended Lean-specific structures.
 *
 * @module
 */

import * as code from 'vscode'
import { Code2ProtocolConverter, DidOpenTextDocumentParams, Protocol2CodeConverter } from 'vscode-languageclient'
import { createConverter as createC2PConverter } from 'vscode-languageclient/lib/common/codeConverter'
import { createConverter as createP2CConverter } from 'vscode-languageclient/lib/common/protocolConverter'
import * as async from 'vscode-languageclient/lib/common/utils/async'
import * as ls from 'vscode-languageserver-protocol'
import { automaticallyBuildDependencies } from '../config'

export type ModuleHierarchyOptions = {}

export interface LeanServerCapabilities {
    moduleHierarchyProvider?: ModuleHierarchyOptions | undefined
}

export enum LeanTag {
    UnsolvedGoals = 1,
    GoalsAccomplished = 2,
}

export interface LeanDiagnostic extends ls.Diagnostic {
    fullRange?: ls.Range
    isSilent?: boolean
    leanTags?: LeanTag[]
}

export interface LeanPublishDiagnosticsParams {
    uri: ls.DocumentUri
    version?: ls.integer
    diagnostics: LeanDiagnostic[]
}

export interface LeanPrepareModuleHierarchyParams {
    textDocument: ls.TextDocumentIdentifier
}

export interface LeanModule {
    name: string
    uri: ls.DocumentUri
    data?: any
}

export type LeanImportMetaKind = 'nonMeta' | 'meta' | 'full'

export interface LeanImportKind {
    isPrivate: boolean
    isAll: boolean
    metaKind: LeanImportMetaKind
}

export interface LeanImport {
    module: LeanModule
    kind: LeanImportKind
}

export interface LeanModuleHierarchyImportsParams {
    module: LeanModule
}

export interface LeanModuleHierarchyImportedByParams {
    module: LeanModule
}

interface SnippetTextEdit extends ls.TextEdit {
    leanExtSnippet: { value: string }
}

namespace SnippetTextEdit {
    export function is(value: any): value is SnippetTextEdit {
        if (!ls.TextEdit.is(value)) return false
        if (!('leanExtSnippet' in value)) return false
        const snip = value.leanExtSnippet
        if (snip === null || typeof snip !== 'object') return false
        if (!('value' in snip)) return false
        if (typeof snip.value !== 'string' && !(snip.value instanceof String)) return false
        return true
    }
}

export function setDependencyBuildMode(
    params: DidOpenTextDocumentParams,
    dependencyBuildMode: 'once' | 'never',
): DidOpenTextDocumentParams {
    const updatedParams: any = params
    updatedParams.dependencyBuildMode = automaticallyBuildDependencies() ? 'always' : dependencyBuildMode
    return updatedParams
}

export const p2cConverter = createP2CConverter(undefined, true, true)
export const c2pConverter = createC2PConverter(undefined)

export function patchConverters(p2cConverter: Protocol2CodeConverter, c2pConverter: Code2ProtocolConverter) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const oldP2cAsDiagnostic = p2cConverter.asDiagnostic
    p2cConverter.asDiagnostic = function (protDiag: LeanDiagnostic): code.Diagnostic {
        if (!protDiag.message) {
            // Fixes: Notification handler 'textDocument/publishDiagnostics' failed with message: message must be set
            protDiag.message = ' '
        }
        const diag = oldP2cAsDiagnostic.apply(this, [protDiag])
        diag.fullRange = p2cConverter.asRange(protDiag.fullRange)
        diag.leanTags = protDiag.leanTags
        diag.isSilent = protDiag.isSilent
        return diag
    }
    // The original definition refers to `asDiagnostic` as a local function
    // rather than as a member of `Protocol2CodeConverter`,
    // so we need to overwrite it, too.
    p2cConverter.asDiagnostics = async (diags, token) => async.map(diags, d => p2cConverter.asDiagnostic(d), token)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const oldC2pAsDiagnostic = c2pConverter.asDiagnostic
    c2pConverter.asDiagnostic = function (
        diag: code.Diagnostic & { fullRange?: code.Range; isSilent?: boolean; leanTags?: LeanTag[] },
    ): LeanDiagnostic {
        const protDiag = oldC2pAsDiagnostic.apply(this, [diag])
        protDiag.fullRange = c2pConverter.asRange(diag.fullRange)
        protDiag.leanTags = diag.leanTags
        protDiag.isSilent = diag.isSilent
        return protDiag
    }
    c2pConverter.asDiagnostics = async (diags, token) => async.map(diags, d => c2pConverter.asDiagnostic(d), token)

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const oldC2pAsOpenTextDocumentParams = c2pConverter.asOpenTextDocumentParams
    c2pConverter.asOpenTextDocumentParams = doc => {
        const params = oldC2pAsOpenTextDocumentParams.apply(this, [doc])
        return setDependencyBuildMode(params, 'never')
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const oldP2CAsWorkspaceEdit = p2cConverter.asWorkspaceEdit
    p2cConverter.asWorkspaceEdit = async function (
        item: ls.WorkspaceEdit | null | undefined,
        token?: code.CancellationToken,
    ) {
        if (item === undefined || item === null) return undefined
        if (item.documentChanges) {
            // 1. Preprocess `documentChanges` by filtering out snippet edits
            // which we support as a Lean-specific extension.
            // 2. Create a `WorkspaceEdit` using the default function
            // which does not take snippet edits into account.
            // 3. Append the snippet edits.
            // Note that this may permute the relative ordering of snippet edits and text edits,
            // so users cannot rely on it;
            // but a mix of both doesn't seem to work in VSCode anyway as of 1.84.2.
            const snippetChanges: [code.Uri, code.SnippetTextEdit[]][] = []
            const documentChanges = await async.map(
                item.documentChanges,
                change => {
                    if (!ls.TextDocumentEdit.is(change)) return true
                    const uri = code.Uri.parse(change.textDocument.uri)
                    const snippetEdits: code.SnippetTextEdit[] = []
                    const edits = change.edits.filter(edit => {
                        if (!SnippetTextEdit.is(edit)) return true
                        const range = p2cConverter.asRange(edit.range)
                        snippetEdits.push(
                            new code.SnippetTextEdit(range, new code.SnippetString(edit.leanExtSnippet.value)),
                        )
                        return false
                    })
                    snippetChanges.push([uri, snippetEdits])
                    return { ...change, edits }
                },
                token,
            )
            const newItem = { ...item, documentChanges }
            const result: code.WorkspaceEdit = await oldP2CAsWorkspaceEdit.apply(this, [newItem, token])
            for (const [uri, snippetEdits] of snippetChanges) result.set(uri, snippetEdits)
            return result
        }
        return oldP2CAsWorkspaceEdit.apply(this, [item, token])
    }

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const oldP2cAsCodeAction = p2cConverter.asCodeAction
    p2cConverter.asCodeAction = async function (
        item: ls.CodeAction | null | undefined,
        token?: code.CancellationToken,
    ) {
        if (item === undefined || item === null) return undefined
        if (item.edit || item.diagnostics) {
            const result: code.CodeAction = await oldP2cAsCodeAction.apply(this, [item, token])
            if (item.diagnostics !== undefined)
                result.diagnostics = await p2cConverter.asDiagnostics(item.diagnostics, token)
            if (item.edit) result.edit = await p2cConverter.asWorkspaceEdit(item.edit, token)
        }
        return oldP2cAsCodeAction.apply(this, [item, token])
    }

    // Note: as of 2023-12-10, there is no c2pConverter.asWorkspaceEdit.
    // This is possibly because code.WorkspaceEdit supports features
    // that cannot be encoded in ls.WorkspaceEdit.
}

patchConverters(p2cConverter, c2pConverter)
