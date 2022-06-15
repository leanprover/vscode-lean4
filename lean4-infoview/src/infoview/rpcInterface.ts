/**
 * Defines TS bindings for RPC calls to the Lean server,
 * as well as some utilities which correspond to Lean functions.
 * TODO(WN): One would like to eventually auto-generate the bindings from Lean code.
 * @module
 */

import { RpcPtr, LeanDiagnostic } from '@lean4/infoview-api'

import { DocumentPosition } from './util'
import { RpcSessions } from './rpcSessions'
import { LocationLink } from 'vscode-languageserver-protocol'

/** A string where certain (possibly nested) substrings have been decorated with objects of type T. */
export type TaggedText<T> =
    { text: string } |
    { append: TaggedText<T>[] } |
    { tag: [T, TaggedText<T>] }

function TaggedText_mapRefs<T>(tt: TaggedText<T>, f: (_: T) => void): void {
    const go = (t: TaggedText<T>) => TaggedText_mapRefs(t, f)
    if ('append' in tt) { for (const a of tt.append) go(a) }
    else if ('tag' in tt) { f(tt.tag[0]); go(tt.tag[1]) }
}

export function TaggedText_stripTags<T>(tt: TaggedText<T>): string {
    const go = (t: TaggedText<T>): string => {
        if ('append' in t)
            return t.append.reduce<string>((acc, t_) => acc + go(t_), '')
        else if ('tag' in t)
            return go(t.tag[1])
        else if ('text' in t)
            return t.text
        return ''
    }
    return go(tt)
}

export type InfoWithCtx = RpcPtr<'Lean.Widget.InfoWithCtx'>

export interface SubexprInfo {
    info: InfoWithCtx
    subexprPos?: number
}

export type CodeWithInfos = TaggedText<SubexprInfo>

/** Information that should appear in a popup when clicking on a subexpression. */
export interface InfoPopup {
    type?: CodeWithInfos
    exprExplicit?: CodeWithInfos
    doc?: string
}

function CodeWithInfos_registerRefs(rs: RpcSessions, pos: DocumentPosition, ci: CodeWithInfos): void {
    TaggedText_mapRefs(ci, ct => rs.registerRef(pos, ct.info))
}

function InfoPopup_registerRefs(rs: RpcSessions, pos: DocumentPosition, ip: InfoPopup): void {
    if (ip.type) CodeWithInfos_registerRefs(rs, pos, ip.type)
    if (ip.exprExplicit) CodeWithInfos_registerRefs(rs, pos, ip.exprExplicit)
}

export async function InteractiveDiagnostics_infoToInteractive(rs: RpcSessions, pos: DocumentPosition, info: InfoWithCtx): Promise<InfoPopup | undefined> {
    const ret = await rs.call<InfoPopup>(pos, 'Lean.Widget.InteractiveDiagnostics.infoToInteractive', info)
    if (ret) InfoPopup_registerRefs(rs, pos, ret)
    return ret
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

/** Filter out inaccessible / anonymous pretty names from the names list. */
export function InteractiveHypothesisBundle_accessibleNames(ih : InteractiveHypothesisBundle) : string[] {
    return ih.names.filter(x => !x.includes('[anonymous]'))
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

function InteractiveGoal_registerRefs(rs: RpcSessions, pos: DocumentPosition, g: InteractiveGoal) {
    CodeWithInfos_registerRefs(rs, pos, g.type)
    for (const h of g.hyps) {
        CodeWithInfos_registerRefs(rs, pos, h.type)
        if (h.val) CodeWithInfos_registerRefs(rs, pos, h.val)
    }
}

export interface InteractiveGoals {
    goals: InteractiveGoal[]
}

function InteractiveGoals_registerRefs(rs: RpcSessions, pos: DocumentPosition, gs: InteractiveGoals) {
    for (const g of gs.goals) InteractiveGoal_registerRefs(rs, pos, g)
}

export async function getInteractiveGoals(rs: RpcSessions, pos: DocumentPosition): Promise<InteractiveGoals | undefined> {
    const ret = await rs.call<InteractiveGoals>(pos, 'Lean.Widget.getInteractiveGoals', DocumentPosition.toTdpp(pos))
    if (ret) InteractiveGoals_registerRefs(rs, pos, ret)
    return ret
}

export async function getInteractiveTermGoal(rs: RpcSessions, pos: DocumentPosition): Promise<InteractiveGoal | undefined> {
    const ret = await rs.call<InteractiveGoal>(pos, 'Lean.Widget.getInteractiveTermGoal', DocumentPosition.toTdpp(pos))
    if (ret) InteractiveGoal_registerRefs(rs, pos, ret)
    return ret
}

export type MessageData = RpcPtr<'Lean.MessageData'>
export type MsgEmbed =
    { expr: CodeWithInfos } |
    { goal: InteractiveGoal } |
    { lazyTrace: [number, string, MessageData] }

function MsgEmbed_registerRefs(rs: RpcSessions, pos: DocumentPosition, e: MsgEmbed): void {
    if ('expr' in e) CodeWithInfos_registerRefs(rs, pos, e.expr)
    else if ('goal' in e) InteractiveGoal_registerRefs(rs, pos, e.goal)
    else if ('lazyTrace' in e) rs.registerRef(pos, e.lazyTrace[2])
}

function TaggedMsg_registerRefs(rs: RpcSessions, pos: DocumentPosition, tt: TaggedText<MsgEmbed>): void {
    const go = (t: TaggedText<MsgEmbed>) => {
        if ('append' in t) { for (const a of t.append) go(a) }
        else if ('tag' in t) { MsgEmbed_registerRefs(rs, pos, t.tag[0]); go(t.tag[1]) }
    }
    go(tt)
}

export type InteractiveDiagnostic = Omit<LeanDiagnostic, 'message'> & { message: TaggedText<MsgEmbed> }

export interface LineRange {
    start: number;
    end: number;
}

export async function getInteractiveDiagnostics(rs: RpcSessions, pos: DocumentPosition, lineRange?: LineRange): Promise<InteractiveDiagnostic[] | undefined> {
    const ret = await rs.call<InteractiveDiagnostic[]>(pos, 'Lean.Widget.getInteractiveDiagnostics', { lineRange })
    if (ret) {
        for (const d of ret) {
            TaggedMsg_registerRefs(rs, pos, d.message)
        }
    }
    return ret
}

export async function InteractiveDiagnostics_msgToInteractive(rs: RpcSessions, pos: DocumentPosition, msg: MessageData, indent: number): Promise<TaggedText<MsgEmbed> | undefined> {
    interface MessageToInteractive {
        msg: MessageData
        indent: number
    }
    const args: MessageToInteractive = { msg, indent }
    const ret = await rs.call<TaggedText<MsgEmbed>>(pos, 'Lean.Widget.InteractiveDiagnostics.msgToInteractive', args)
    if (ret) TaggedMsg_registerRefs(rs, pos, ret)
    return ret
}

export type GoToKind = 'declaration' | 'definition' | 'type'
export async function getGoToLocation(rs: RpcSessions, pos: DocumentPosition, kind: GoToKind, info: InfoWithCtx): Promise<LocationLink[] | undefined> {
    interface GetGoToLocationParams {
        kind: GoToKind;
        info: InfoWithCtx;
    }
    const args: GetGoToLocationParams = { kind, info };
    return rs.call<LocationLink[]>(pos, 'Lean.Widget.getGoToLocation', args)
}
