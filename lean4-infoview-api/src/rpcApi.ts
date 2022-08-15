/**
 * Defines TS bindings for RPC calls to the Lean server,
 * as well as some utilities which correspond to Lean functions.
 * TODO(WN): One would like to eventually auto-generate the bindings from Lean code.
 * @module
 */

import type { LocationLink, Position, Range, TextDocumentPositionParams } from 'vscode-languageserver-protocol'
import { LeanDiagnostic, RpcPtr } from './lspTypes'
import { RpcSessionAtPos } from './rpcSessions'

/** A string where certain (possibly nested) substrings have been decorated with objects of type T. */
export type TaggedText<T> =
    { text: string } |
    { append: TaggedText<T>[] } |
    { tag: [T, TaggedText<T>] }

export type InfoWithCtx = RpcPtr<'Lean.Widget.InfoWithCtx'>

export interface SubexprInfo {
    info: InfoWithCtx
    subexprPos?: number
}

/** A piece of code pretty-printed with subexpression information by the Lean server. */
export type CodeWithInfos = TaggedText<SubexprInfo>

/** Information that should appear in a popup when clicking on a subexpression. */
export interface InfoPopup {
    type?: CodeWithInfos
    exprExplicit?: CodeWithInfos
    doc?: string
}

export interface InteractiveHypothesisBundle {
    isInstance?: boolean,
    isType?: boolean,
    /** The pretty names of the variables in the bundle.
     * If the name is inaccessible this will be `"[anonymous]"`.
     * Use `InteractiveHypothesis_accessibleNames` to filter these out.
     */
    names: string[]
    /** The free variable id associated with each of the vars listed in `names`. */
    fvarIds?: string[]
    type: CodeWithInfos
    val?: CodeWithInfos
}

export interface InteractiveGoal {
    hyps: InteractiveHypothesisBundle[]
    type: CodeWithInfos
    userName?: string
    goalPrefix?: string
    /** metavariable id associated with the goal.
     * This is undefined when the goal is a term goal
     * or if we are using an older version of lean. */
    mvarId?: string
}

export interface InteractiveGoals {
    goals: InteractiveGoal[]
}

export function getInteractiveGoals(rs: RpcSessionAtPos, pos: TextDocumentPositionParams): Promise<InteractiveGoals | undefined> {
    return rs.call('Lean.Widget.getInteractiveGoals', pos);
}

export function getInteractiveTermGoal(rs: RpcSessionAtPos, pos: TextDocumentPositionParams): Promise<InteractiveGoal | undefined> {
    return rs.call('Lean.Widget.getInteractiveTermGoal', pos);
}

export type Name = string

export type StrictOrLazy<S, L> = { strict: S } | { lazy: L }
export type LazyTraceChildren = RpcPtr<'Lean.Widget.LazyTraceChildren'>
export interface TraceEmbed {
    indent: number;
    cls: Name;
    msg: TaggedText<MsgEmbed>;
    collapsed: boolean; // collapsed by default
    children: StrictOrLazy<TaggedText<MsgEmbed>[], LazyTraceChildren>;
}

export type MessageData = RpcPtr<'Lean.MessageData'>
export type MsgEmbed =
    { expr: CodeWithInfos } |
    { goal: InteractiveGoal } |
    { trace: TraceEmbed } |
    { lazyTrace: [number, Name, MessageData] } // old collapsible trace support

export type InteractiveDiagnostic = Omit<LeanDiagnostic, 'message'> & { message: TaggedText<MsgEmbed> }

export interface LineRange {
    start: number;
    end: number;
}

export function getInteractiveDiagnostics(rs: RpcSessionAtPos, lineRange?: LineRange): Promise<InteractiveDiagnostic[]> {
    return rs.call('Lean.Widget.getInteractiveDiagnostics', {lineRange});
}

export function InteractiveDiagnostics_msgToInteractive(rs: RpcSessionAtPos, msg: MessageData, indent: number): Promise<TaggedText<MsgEmbed>> {
    interface MessageToInteractive {
        msg: MessageData
        indent: number
    }
    return rs.call<MessageToInteractive, TaggedText<MsgEmbed>>('Lean.Widget.InteractiveDiagnostics.msgToInteractive', {msg, indent})
}

export function lazyTraceChildrenToInteractive(rs: RpcSessionAtPos, children: LazyTraceChildren): Promise<TaggedText<MsgEmbed>[]> {
    return rs.call('Lean.Widget.lazyTraceChildrenToInteractive', children)
}

export function InteractiveDiagnostics_infoToInteractive(rs: RpcSessionAtPos, info: InfoWithCtx): Promise<InfoPopup> {
    return rs.call('Lean.Widget.InteractiveDiagnostics.infoToInteractive', info);
}

export type GoToKind = 'declaration' | 'definition' | 'type'
export function getGoToLocation(rs: RpcSessionAtPos, kind: GoToKind, info: InfoWithCtx): Promise<LocationLink[]> {
    interface GetGoToLocationParams {
        kind: GoToKind;
        info: InfoWithCtx;
    }
    return rs.call<GetGoToLocationParams, LocationLink[]>('Lean.Widget.getGoToLocation', { kind, info });
}

export interface UserWidget {
    id: string;
    /** Pretty user name. */
    name: string;
    /** A hash (provided by Lean) of the widgetSource's sourcetext.
     * This is used to look up the WidgetSource object.
     */
    javascriptHash: string;
}

/** Represents an instance of a user widget that can be rendered.
 * This is used as the input to the `UserWidget` component.
 */
export interface UserWidgetInstance extends UserWidget {
    /** JSON object to be passed as props to the component */
    props : any
    range?: Range
}

/** The response type for the RPC call `Widget_getWidgets`. */
export interface UserWidgets {
    widgets : UserWidgetInstance[]
}

/** Given a position, returns all of the user-widgets on the infotree at this position. */
export function Widget_getWidgets(rs: RpcSessionAtPos, pos: Position): Promise<UserWidgets> {
    return rs.call<Position, UserWidgets>('Lean.Widget.getWidgets', pos)
}

/** Code that should be dynamically loaded by the UserWidget component. */
export interface WidgetSource {
    /** JavaScript sourcecode. Should be a plain JavaScript ESModule whose default export is
     * the component to render.
     */
    sourcetext: string
}

/** Gets the static code for a given widget.
 *
 * We make the assumption that either the code doesn't exist, or it exists and does not change for the lifetime of the widget.
 */
export function Widget_getWidgetSource(rs: RpcSessionAtPos, pos: Position, hash: string): Promise<WidgetSource> {
    interface GetWidgetSourceParams {
        hash: string
        pos: Position
    }
    return rs.call<GetWidgetSourceParams, WidgetSource>('Lean.Widget.getWidgetSource', { pos, hash })
}
