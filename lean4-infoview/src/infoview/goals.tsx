import * as React from 'react'
import { DocumentPosition } from './util'
import { ConfigContext } from './contexts'
import { InteractiveCode } from './interactiveCode'
import { InteractiveGoal, InteractiveGoals, TaggedText, TaggedText_stripTags } from './rpcInterface'

function goalToString(g: InteractiveGoal): string {
    let ret = ''

    if (g.userName) {
        ret += `case ${g.userName}\n`
    }

    for (const h of g.hyps) {
        const names = h.names.join(' ')
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

export function Goal({pos, goal, reverse}: {pos: DocumentPosition, goal: InteractiveGoal, reverse: boolean}) {
    const prefix = goal.goalPrefix ?? '⊢ '
    const hyps = reverse  ? goal.hyps.slice().reverse() : goal.hyps;
    const goalLi  = <li key={'goal'}>
                        <strong className="goal-vdash">{prefix}</strong><InteractiveCode pos={pos} fmt={goal.type} />
                     </li>
    return <div className="font-code tl pre-wrap">
        <ul className="list pl0">
            {goal.userName && <li key={'case'}><strong className="goal-case">case </strong>{goal.userName}</li>}
            {reverse && goalLi }
            {hyps.map ((h, i) => {
                const names = h.names.reduce((acc, n) => acc + ' ' + n, '').slice(1)
                return <li key={`hyp-${i}`}>
                    <strong className="goal-hyp">{names}</strong> : <InteractiveCode pos={pos} fmt={h.type} />{h.val && <> := <InteractiveCode pos={pos} fmt={h.val}/></>}
                </li>
            })}
            {!reverse && goalLi }
        </ul>
    </div>
}

export function Goals({pos, goals, reverseOrder}: {pos: DocumentPosition, goals: InteractiveGoals, reverseOrder: boolean}) {
    const config = React.useContext(ConfigContext)
    // TODO re-add?
    const reFilters = config.infoViewTacticStateFilters || []
    const [filterIndex, setFilterIndex] = React.useState<number>(config.filterIndex ?? -1)

    if (goals.goals.length === 0) {
        return <>Goals accomplished 🎉</>
    } else {
        return <>
            {goals.goals.map ((g, i) => <Goal key={i} pos={pos} goal={g} reverse={reverseOrder}/>)}
        </>
    }
}
