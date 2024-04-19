/*
Copyright (c) 2022 E.W.Ayers. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: E.W.Ayers, Wojciech Nawrocki
*/
import { FVarId, MVarId, SubexprPos } from '@leanprover/infoview-api'
import * as React from 'react'
import { DetectHoverSpan, HoverState } from './tooltips'

/**
 * A location within a goal. It is either:
 * - one of the hypotheses; or
 * - (a subexpression of) the type of one of the hypotheses; or
 * - (a subexpression of) the value of one of the let-bound hypotheses; or
 * - (a subexpression of) the goal type. */
export type GoalLocation =
    | { hyp: FVarId }
    | { hypType: [FVarId, SubexprPos] }
    | { hypValue: [FVarId, SubexprPos] }
    | { target: SubexprPos }

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace GoalLocation {
    export function isEqual(l1: GoalLocation, l2: GoalLocation): boolean {
        if ('hyp' in l1) return 'hyp' in l2 ? l1.hyp === l2.hyp : false
        else if ('hypType' in l1)
            return 'hypType' in l2 ? l1.hypType[0] === l2.hypType[0] && l1.hypType[1] === l2.hypType[1] : false
        else if ('hypValue' in l1)
            return 'hypValue' in l2 ? l1.hypValue[0] === l2.hypValue[0] && l1.hypValue[1] === l2.hypValue[1] : false
        else if ('target' in l1) return 'target' in l2 ? l1.target === l2.target : false
        else return false
    }

    export function withSubexprPos(l: GoalLocation, p: SubexprPos): GoalLocation {
        if ('hyp' in l) return l
        else if ('hypType' in l) return { hypType: [l.hypType[0], p] }
        else if ('hypValue' in l) return { hypValue: [l.hypValue[0], p] }
        else if ('target' in l) return { target: p }
        else throw new Error(`unrecognized GoalLocation variant ${JSON.stringify(l)}`)
    }
}

/**
 * A location within a goal state. It identifies a specific goal together with a {@link GoalLocation}
 * within it.  */
export interface GoalsLocation {
    /** Which goal the location is in. */
    mvarId: MVarId
    loc: GoalLocation
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace GoalsLocation {
    export function isEqual(l1: GoalsLocation, l2: GoalsLocation): boolean {
        return l1.mvarId === l2.mvarId && GoalLocation.isEqual(l1.loc, l2.loc)
    }

    export function withSubexprPos(l: GoalsLocation, p: SubexprPos): GoalsLocation {
        return { ...l, loc: GoalLocation.withSubexprPos(l.loc, p) }
    }
}

/**
 * An interface available through a React context in components where selecting subexpressions
 * makes sense. Currently this is only the goal state display. There, {@link GoalLocation}s can be
 * selected. */
export interface Locations {
    isSelected: (l: GoalsLocation) => boolean
    setSelected: (l: GoalsLocation, fn: React.SetStateAction<boolean>) => void
    /**
     * A template for the location of the current component. It is defined if and only if the current
     * component is a subexpression of a selectable expression. We use
     * {@link GoalsLocation.withSubexprPos} to map this template to a complete location. */
    subexprTemplate?: GoalsLocation
}

export const LocationsContext = React.createContext<Locations | undefined>(undefined)

type SelectableLocationProps = React.PropsWithoutRef<
    React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>
> & {
    locs?: Locations
    loc?: GoalsLocation
    alwaysHighlight: boolean
    setHoverState?: React.Dispatch<React.SetStateAction<HoverState>>
}

/**
 * A `<span>` with a corresponding {@link GoalsLocation} which can be (un)selected using shift-click.
 * If `locs` or `loc` is `undefined`, selection functionality is turned off. The element is also
 * highlighted when hovered over if `alwaysHighlight` is `true` or `locs` and `loc` are both defined.
 * `setHoverState` is passed through to {@link DetectHoverSpan}. */
export function SelectableLocation(props_: SelectableLocationProps): JSX.Element {
    const { locs, loc, alwaysHighlight, setHoverState: setParentHoverState, ...props } = props_

    const shouldHighlight: boolean = alwaysHighlight || (!!locs && !!loc)
    const [hoverState, setHoverState] = React.useState<HoverState>('off')
    let spanClassName: string = ''
    if (shouldHighlight) {
        spanClassName += 'highlightable '
        if (hoverState !== 'off') spanClassName += 'highlight '
        if (props.className) spanClassName += props.className
    }

    const innerSpanClassName: string =
        'highlightable ' + (locs && loc && locs.isSelected(loc) ? 'highlight-selected ' : '')

    const setHoverStateAll: React.Dispatch<React.SetStateAction<HoverState>> = React.useCallback(
        val => {
            setHoverState(val)
            if (setParentHoverState) setParentHoverState(val)
        },
        [setParentHoverState],
    )

    return (
        <DetectHoverSpan
            {...props}
            setHoverState={setHoverStateAll}
            className={spanClassName}
            onClick={e => {
                // On shift-click, if we are in a context where selecting subexpressions makes sense,
                // (un)select the current subexpression.
                if (e.shiftKey && locs && loc) {
                    locs.setSelected(loc, on => !on)
                    e.stopPropagation()
                }
                if (props.onClick) props.onClick(e)
            }}
            onPointerDown={e => {
                // Since shift-click on this component is a custom selection, when shift is held prevent
                // the default action which on text is to start a text selection.
                if (e.shiftKey) e.preventDefault()
                if (props.onPointerDown) props.onPointerDown(e)
            }}
        >
            {/* Note: we use two spans so that the two `highlight`s don't interfere. */}
            <span className={innerSpanClassName}>{props.children}</span>
        </DetectHoverSpan>
    )
}
