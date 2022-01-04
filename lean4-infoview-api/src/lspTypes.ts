import { Diagnostic, DocumentUri, Range, TextDocumentPositionParams, VersionedTextDocumentIdentifier } from 'vscode-languageserver-protocol';

// Lean 4 extensions to LSP.

/** Used in place of {@link Diagnostic} within `textDocument/publishDiagnostics`. */
export interface LeanDiagnostic extends Diagnostic {
    fullRange?: Range; // introduced in 2021-03-10
}

export interface PlainGoal {
    rendered: string;
    goals: string[];
}

export interface PlainTermGoal {
    goal: string;
    range: Range;
}

// Seems to be an eslint bug:
// eslint-disable-next-line no-shadow
export enum LeanFileProgressKind {
    Processing = 1,
    FatalError = 2
}

export interface LeanFileProgressProcessingInfo {
    /** Range for which the processing info was reported. */
    range: Range;
    /** Kind of progress that was reported. */
    kind?: LeanFileProgressKind;
}

export interface LeanFileProgressParams {
    /** The text document to which this progress notification applies. */
    textDocument: VersionedTextDocumentIdentifier;

    /**
     * Array containing the parts of the file which are still being processed.
     * The array should be empty if and only if the server is finished processing.
     */
    processing: LeanFileProgressProcessingInfo[];
}

// https://stackoverflow.com/a/56749647
declare const tag: unique symbol;
export type RpcPtr<T> = { readonly [tag]: T, p: string }

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace RpcPtr {

export function copy<T>(p: RpcPtr<T>): RpcPtr<T> {
    return { p: p.p } as RpcPtr<T>;
}

/** Turns a reference into a unique string. Useful for React `key`s. */
export function toKey(p: RpcPtr<any>): string {
    return p.p;
}

}

export interface RpcConnectParams {
    uri: DocumentUri;
}

export interface RpcConnected {
    sessionId: string
}

export interface RpcKeepAliveParams {
    uri: DocumentUri
    sessionId: string
}

export interface RpcCallParams extends TextDocumentPositionParams {
    sessionId: string
    method: string
    params: any
}

export interface RpcReleaseParams {
    uri: DocumentUri
    sessionId: string
    refs: RpcPtr<any>[]
}

export const RpcNeedsReconnect = -32900
