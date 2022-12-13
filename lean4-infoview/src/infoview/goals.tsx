import * as React from 'react'
import { InteractiveCode } from './interactiveCode'
import { InteractiveGoal, InteractiveGoals, InteractiveHypothesisBundle, InteractiveHypothesisBundle_nonAnonymousNames, TaggedText_stripTags } from '@leanprover/infoview-api'

interface HypProps {
    hyp: InteractiveHypothesisBundle
}

/** Returns true if `h` is inaccessible according to Lean's default name rendering. */
function isInaccessibleName(h: string): boolean {
    return h.indexOf('✝') >= 0;
}

export function Hyp({ hyp: h }: HypProps) {
    let namecls : string = ''
    if (h.isInserted) {
        namecls += 'inserted-text '
    } else if (h.isRemoved) {
        namecls += 'removed-text '
    }
    const names = InteractiveHypothesisBundle_nonAnonymousNames(h).map((n, i) =>
        <span className={ 'mr1 ' + (isInaccessibleName(n) ? 'goal-inaccessible ' : '') + namecls} key={i}>{n}</span>
    )
    return <div>
        <strong className="goal-hyp">{names}</strong>
        :&nbsp;
        <InteractiveCode fmt={h.type} />
        {h.val && <>&nbsp;:=&nbsp;<InteractiveCode fmt={h.val} /></>}
    </div>
}

function goalToString(g: InteractiveGoal): string {
    let ret = ''

    if (g.userName) {
        ret += `case ${g.userName}\n`
    }

    for (const h of g.hyps) {
        const names = InteractiveHypothesisBundle_nonAnonymousNames(h).join(' ')
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
    /** If true reverse the list of hypotheses, if false present the order received from LSP. */
    reverse: boolean,
    /** If true show hypotheses that have isType=True, otherwise hide them. */
    showType: boolean,
    /** If true show hypotheses that have isInstance=True, otherwise hide them. */
    showInstance: boolean,
    /** If true show hypotheses that contain a dagger in the name, otherwise hide them. */
    showHiddenAssumption: boolean
    /** If true show the bodies of let-values, otherwise hide them. */
    showLetValue: boolean;
}

function getFilteredHypotheses(hyps: InteractiveHypothesisBundle[], filter: GoalFilterState): InteractiveHypothesisBundle[] {
    return hyps.reduce((acc: InteractiveHypothesisBundle[], h) => {
        if (h.isInstance && !filter.showInstance) return acc
        if (h.isType && !filter.showType) return acc
        const names = filter.showHiddenAssumption ? h.names : h.names.filter(n => !isInaccessibleName(n))
        const hNew: InteractiveHypothesisBundle = filter.showLetValue ? { ...h, names } : { ...h, names, val: undefined }
        if (names.length !== 0) acc.push(hNew)
        return acc
    }, [])
}

interface GoalProps {
    goal: InteractiveGoal
    filter: GoalFilterState
    /** Where the goal appears in the goal list. Or none if not present. */
    index?: number
}

export const Goal = React.memo((props: GoalProps) => {
    const { goal, filter } = props
    const prefix = goal.goalPrefix ?? '⊢ '
    const filteredList = getFilteredHypotheses(goal.hyps, filter);
    const hyps = filter.reverse ? filteredList.slice().reverse() : filteredList;
    const goalLi = <div key={'goal'}>
        <strong className="goal-vdash">{prefix}</strong>
        <InteractiveCode fmt={goal.type} />
    </div>
    let cn = 'font-code tl pre-wrap mv1 bl bw1 pl1 b--transparent '
    if (props.goal.isInserted) {
        cn += 'b--inserted '
    }
    if (props.goal.isRemoved) {
        cn += 'b--removed '
    }
    return <div className={cn}>
        {goal.userName && <div key={'case'}><strong className="goal-case">case </strong>{goal.userName}</div>}
        {filter.reverse && goalLi}
        {hyps.map((h, i) => <Hyp hyp={h} key={i} />)}
        {!filter.reverse && goalLi}
    </div>
})

interface GoalsProps {
    goals: InteractiveGoals
    filter: GoalFilterState
}

export function Goals({ goals, filter }: GoalsProps) {
    if (goals.goals.length === 0) {
        return <>Goals accomplished 🎉</>
    } else {
        return <>
            {goals.goals.map((g, i) => <Goal key={i} goal={g} filter={filter} index={i} />)}
        </>
    }
}
