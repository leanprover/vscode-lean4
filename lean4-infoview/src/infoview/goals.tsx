import * as React from 'react'
import { DocumentPosition } from './util'
import { InteractiveCode } from './interactiveCode'
import { InteractiveGoal, InteractiveGoals, InteractiveHypothesisBundle, InteractiveHypothesisBundle_accessableNames, TaggedText_stripTags } from './rpcInterface'

interface HypProps {
    pos: DocumentPosition
    hyp: InteractiveHypothesisBundle
    index: number
}

export function Hyp({ pos, hyp : h, index }: HypProps) {
    const names = InteractiveHypothesisBundle_accessableNames(h).map((n, i) =>
            <span className="mr1">{n}</span>
        )
    const hypKey = (h.fvarIds?.[0] ?? index)
    return <li>
            <strong className="goal-hyp">{names}</strong>
            :&nbsp;
            <InteractiveCode pos={pos} fmt={h.type} />
            {h.val && <>
                := <InteractiveCode pos={pos} fmt={h.val} />
            </>}
    </li>
}

function goalToString(g: InteractiveGoal): string {
    let ret = ''

    if (g.userName) {
        ret += `case ${g.userName}\n`
    }

    for (const h of g.hyps) {
        const names = InteractiveHypothesisBundle_accessableNames(h).join(' ')
        ret += `${names} : ${TaggedText_stripTags(h.type)}`
        if (h.val) {
            ret += ` := ${TaggedText_stripTags(h.val)}`
        }
        ret += '\n'
    }

    ret += `⊢ ${TaggedText_stripTags(g.type)}`

    return ret
}

export function goalsToString(goals: InteractiveGoals): string {
    return goals.goals.map(goalToString).join('\n\n')
}

export interface GoalFilterState {
    /** If true reverse the list of InteractiveHypothesisBundle, if false present the order received from LSP */
    reverse: boolean,
    /** If true show InteractiveHypothesisBundle that have isType=True, if false, hide InteractiveHypothesisBundle that have isType=True. */
    isType: boolean,
    /** If true show InteractiveHypothesisBundle that have isInstance=True, if false, hide InteractiveHypothesisBundle that have isInstance=True. */
    isInstance: boolean,
    /** If true show InteractiveHypothesisBundle that contain a dagger in the name, if false, hide InteractiveHypothesisBundle that contain a dagger in the name. */
    isHiddenAssumption: boolean
}

function isHiddenAssumption(h: InteractiveHypothesisBundle) {
    return h.names.every(n => n.indexOf('✝') >= 0);
}

function getFilteredHypotheses(hyps: InteractiveHypothesisBundle[], filter: GoalFilterState): InteractiveHypothesisBundle[] {
    return hyps.filter(h =>
        (!h.isInstance || filter.isInstance) &&
        (!h.isType || filter.isType) &&
        (filter.isHiddenAssumption || !isHiddenAssumption(h)));
}

interface GoalProps {
    pos: DocumentPosition
    goal: InteractiveGoal
    filter: GoalFilterState
    /** Where the goal appears in the goal list. */
    index: number
}


export function Goal({ pos, goal, filter, index }: GoalProps) {
    const prefix = goal.goalPrefix ?? '⊢ '
    const filteredList = getFilteredHypotheses(goal.hyps, filter);
    const hyps = filter.reverse ? filteredList.slice().reverse() : filteredList;
    const goalId = goal.mvarId || index
    const goalLi = <li key={'goal'}>
        <strong className="goal-vdash">{prefix}</strong>
        <InteractiveCode pos={pos} fmt={goal.type} />
    </li>
    return <div className="font-code tl pre-wrap">
        <ul className="list pl0">
            {goal.userName && <li key={'case'}><strong className="goal-case">case </strong>{goal.userName}</li>}
            {filter.reverse && goalLi}
            {hyps.map((h, i) => <Hyp pos={pos} index={i} hyp={h} key={i}/>)}
            {!filter.reverse && goalLi}
        </ul>
    </div>
}

interface GoalsProps {
    pos: DocumentPosition
    goals: InteractiveGoals
    filter: GoalFilterState
}

export function Goals({ pos, goals, filter }: GoalsProps) {
    if (goals.goals.length === 0) {
        return <>Goals accomplished 🎉</>
    } else {
        return <>
            {goals.goals.map((g, i) => <Goal key={g.mvarId || i} pos={pos} goal={g} filter={filter} index={i} />)}
        </>
    }
}
