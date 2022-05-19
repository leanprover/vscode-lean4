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

import { createConverter as createP2CConverter } from 'vscode-languageclient/lib/common/protocolConverter';
import { createConverter as createC2PConverter } from 'vscode-languageclient/lib/common/codeConverter';
import * as ls from 'vscode-languageserver-protocol'
import * as code from 'vscode'
import { Code2ProtocolConverter, Protocol2CodeConverter } from 'vscode-languageclient';

interface Lean4Diagnostic extends ls.Diagnostic {
    fullRange: ls.Range;
}

export const p2cConverter = createP2CConverter(undefined, true, true)
export const c2pConverter = createC2PConverter(undefined)

export function patchConverters(p2cConverter: Protocol2CodeConverter, c2pConverter: Code2ProtocolConverter) {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const oldAsDiagnostic = p2cConverter.asDiagnostic
    p2cConverter.asDiagnostic = function (protDiag: Lean4Diagnostic): code.Diagnostic {
        if (!protDiag.message) {
            // Fixes: Notification handler 'textDocument/publishDiagnostics' failed with message: message must be set
            protDiag.message = ' ';
        }
        const diag = oldAsDiagnostic.apply(this, [protDiag])
        diag.fullRange = p2cConverter.asRange(protDiag.fullRange)
        return diag
    }
    p2cConverter.asDiagnostics = async (diags) => diags.map(d => p2cConverter.asDiagnostic(d))


    // eslint-disable-next-line @typescript-eslint/unbound-method
    const c2pAsDiagnostic = c2pConverter.asDiagnostic
    c2pConverter.asDiagnostic = function (diag: code.Diagnostic & {fullRange: code.Range}): Lean4Diagnostic {
        const protDiag = c2pAsDiagnostic.apply(this, [diag])
        protDiag.fullRange = c2pConverter.asRange(diag.fullRange)
        return protDiag
    }
    c2pConverter.asDiagnostics = async (diags) => diags.map(d => c2pConverter.asDiagnostic(d))
}

patchConverters(p2cConverter, c2pConverter)
