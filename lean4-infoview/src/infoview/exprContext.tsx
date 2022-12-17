/*
Copyright (c) 2022 E.W.Ayers. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Authors: E.W.Ayers, Wojciech Nawrocki
*/
import { FVarId, MVarId, SubexprPos } from "@leanprover/infoview-api";
import * as React from 'react';

/**
 * A location within a goal. It is either:
 * - one of the hypotheses; or
 * - (a subexpression of) the type of one of the hypotheses; or
 * - (a subexpression of) the value of one of the let-bound hypotheses; or
 * - (a subexpression of) the goal type. */
export type GoalLocation =
  { hyp: FVarId }
  | { hypType: [FVarId, SubexprPos] }
  | { hypValue: [FVarId, SubexprPos] }
  | { target: SubexprPos }

export namespace GoalLocation {
  export function isEqual(l1: GoalLocation, l2: GoalLocation): boolean {
    if ('hyp' in l1) return 'hyp' in l2 ? l1.hyp === l2.hyp : false
    else if ('hypType' in l1) return 'hypType' in l2 ? l1.hypType[0] === l2.hypType[0] && l1.hypType[1] === l2.hypType[1] : false
    else if ('hypValue' in l1) return 'hypValue' in l2 ? l1.hypValue[0] === l2.hypValue[0] && l1.hypValue[1] === l2.hypValue[1] : false
    else if ('target' in l1) return 'target' in l2 ? l1.target === l2.target : false
    else return false
  }

  export function withSubexprPos(l: GoalLocation, p: SubexprPos): GoalLocation {
    if ('hyp' in l) return l
    else if ('hypType' in l) return { hypType: [ l.hypType[0], p ] }
    else if ('hypValue' in l) return { hypValue: [ l.hypValue[0], p ] }
    else if ('target' in l) return { target: p }
    else throw new Error(`unrecognized GoalLocation variant ${JSON.stringify(l)}`)
  }
}

/**
 * A location within a goal state. It identifies a specific goal together with a {@link GoalLocation}
 * within it.  */
export interface GoalsLocation {
    /** Which goal the location is in. */
    mvarId: MVarId;
    loc: GoalLocation;
}

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
 * makes sense. Currently this is only the goal state display in which {@link GoalLocation}s
 * can be selected. */
export interface Locations {
  isSelected: (l: GoalsLocation) => void
  setSelected: (l: GoalsLocation, on: boolean) => void
  /**
   * A template for the location of the current component. It is defined if and only if the current
   * component is a subexpression of a selectable expression. We use
   * {@link GoalsLocation.withSubexprPos} to map this template to a complete location. */
  subexprTemplate?: GoalsLocation
}

export const LocationsContext = React.createContext<Locations | undefined>(undefined)

type SelectableLocationProps =
    React.PropsWithoutRef<React.DetailedHTMLProps<React.HTMLAttributes<HTMLSpanElement>, HTMLSpanElement>> &
    { locs: Locations, loc: GoalsLocation }

export function SelectableLocation(props: SelectableLocationProps): JSX.Element {
    const [isSelected, setSelected] = React.useState<boolean>(false)

    const spanClassName: string = 'highlightable '
        + (isSelected ? 'highlight-selected ' : '')
        + (props.className ? props.className : '')

    return <span {...props}
        className={spanClassName}
        onClick={e => {
            if (e.shiftKey) {
              setSelected(on => {
                props.locs.setSelected(props.loc, !on)
                return !on
              })
              e.stopPropagation()
            }
            if (props.onClick) props.onClick(e)
        }}
        onPointerDown={e => {
          // Since shift-click on this component is a custom selection, when shift is held prevent
          // the default action which on text is to start a text selection.
          if (e.shiftKey) e.preventDefault()
        }}
      >
        {props.children}
      </span>
}
