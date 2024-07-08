/*
Copyright (c) 2022 E.W.Ayers. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: E.W.Ayers, Wojciech Nawrocki
*/
import { FVarId, MVarId, SubexprPos } from '@leanprover/infoview-api'
import * as React from 'react'
import { HoverState } from './tooltips'

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

export type HoverSettings = { highlightOnHover: true } | { highlightOnHover: false }
export type ModHoverSettings = { highlightOnModHover: true } | { highlightOnModHover: false }
export type SelectionSettings = { highlightOnSelection: true; loc: GoalsLocation } | { highlightOnSelection: false }
export interface LocationHighlightSettings {
    ref: React.RefObject<HTMLSpanElement>
    hoverSettings: HoverSettings
    modHoverSettings: ModHoverSettings
    selectionSettings: SelectionSettings
}
export interface HighlightedLocation {
    hoverState: HoverState
    setHoverState: React.Dispatch<React.SetStateAction<HoverState>>
    className: string
    onPointerEvent: (b: boolean, e: React.PointerEvent<HTMLSpanElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLSpanElement>) => void
    onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => void
    onKeyUp: (e: React.KeyboardEvent<HTMLSpanElement>) => void
    onClick: (e: React.MouseEvent<HTMLSpanElement, MouseEvent>) => boolean
    onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => void
}

/**
 * Logic for a `<span>` with a corresponding {@link GoalsLocation} which can be (un)selected using shift-click.
 */
export function useHighlightedLocation(settings: LocationHighlightSettings): HighlightedLocation {
    const { ref, hoverSettings, modHoverSettings, selectionSettings } = settings

    const [hoverState, setHoverState] = React.useState<HoverState>('off')

    const locs = React.useContext(LocationsContext)
    let className: string = ''
    if (hoverSettings.highlightOnHover && hoverState !== 'off') {
        className += 'highlight '
    } else if (selectionSettings.highlightOnSelection && locs && locs.isSelected(selectionSettings.loc)) {
        className += 'highlight-selected '
    }
    if (modHoverSettings.highlightOnModHover && hoverState === 'ctrlOver') {
        className += 'underline '
    }

    const onPointerEvent = (b: boolean, e: React.PointerEvent<HTMLSpanElement>) => {
        // It's more composable to let pointer events bubble up rather than to call `stopPropagation`,
        // but we only want to handle hovers in the innermost component. So we record that the
        // event was handled with a property.
        // The `contains` check ensures that the node hovered over is a child in the DOM
        // tree and not just a logical React child (see useLogicalDom and
        // https://reactjs.org/docs/portals.html#event-bubbling-through-portals).
        if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) {
            if ('_DetectHoverSpanSeen' in e) return
            ;(e as any)._DetectHoverSpanSeen = {}
            if (!b) setHoverState('off')
            else if (e.ctrlKey || e.metaKey) setHoverState('ctrlOver')
            else setHoverState('over')
        }
    }

    const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
        if (e.ctrlKey || e.metaKey) setHoverState(st => (st === 'over' ? 'ctrlOver' : st))
        else setHoverState(st => (st === 'ctrlOver' ? 'over' : st))
    }

    const onKeyDown = (e: React.KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === 'Control' || e.key === 'Meta') {
            setHoverState(st => (st === 'over' ? 'ctrlOver' : st))
        }
    }

    const onKeyUp = (e: React.KeyboardEvent<HTMLSpanElement>) => {
        if (e.key === 'Control' || e.key === 'Meta') {
            setHoverState(st => (st === 'ctrlOver' ? 'over' : st))
        }
    }

    const onClick = (e: React.MouseEvent<HTMLSpanElement, MouseEvent>) => {
        // On shift-click, if we are in a context where selecting subexpressions makes sense,
        // (un)select the current subexpression.
        if (selectionSettings.highlightOnSelection && locs && e.shiftKey) {
            locs.setSelected(selectionSettings.loc, on => !on)
            e.stopPropagation()
            return true
        }
        return false
    }

    const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
        // We have special handling for shift+click events, so prevent default browser
        // events from interfering when shift is held.
        if (selectionSettings.highlightOnSelection && locs && e.shiftKey) {
            e.preventDefault()
        }
    }

    return {
        hoverState,
        setHoverState,
        className,
        onPointerEvent,
        onPointerMove,
        onKeyDown,
        onKeyUp,
        onClick,
        onPointerDown,
    }
}
