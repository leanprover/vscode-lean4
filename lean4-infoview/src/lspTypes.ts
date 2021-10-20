import { Diagnostic, Range, VersionedTextDocumentIdentifier } from 'vscode-languageserver-protocol';

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

export interface LeanFileProgressProcessingInfo {
    /** Range which is still being processed */
    range: Range;
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

export namespace RpcPtr {

export function copy<T>(p: RpcPtr<T>): RpcPtr<T> {
    return { p: p.p } as RpcPtr<T>;
}

/** Turns a reference into a unique string. Useful for React `key`s. */
export function toKey(p: RpcPtr<any>): string {
    return p.p;
}

}
