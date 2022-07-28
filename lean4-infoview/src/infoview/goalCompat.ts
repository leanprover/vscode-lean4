import { InteractiveGoal, InteractiveGoals, InteractiveHypothesisBundle, PlainGoal, PlainTermGoal } from '@leanprover/infoview-api';

function getGoals(plainGoals: PlainGoal): string[] {
    if (plainGoals.goals) return plainGoals.goals
    const goals: string[] = [];
    const r = /```lean\n([^`]*)```/g
    let match: RegExpExecArray | null
    const unformatted = plainGoals.rendered;
    do {
        match = r.exec(unformatted)
        if (match) {
            goals.push(match[1])
        }
    } while (match)
    return goals;
}

function transformGoalToInteractive(g: string): InteractiveGoal {
    // this regex splits the goal state into (possibly multi-line) hypothesis and goal blocks
    // by keeping indented lines with the most recent non-indented line
    const parts = (g.match(/(^(?!  ).*\n?(  .*\n?)*)/mg) ?? []).map(line => line.trim())
    let userName
    const hyps: InteractiveHypothesisBundle[] = []
    let type = ''
    for (const p of parts) {
        if (p.match(/^(⊢) /mg)) {
            type = p.slice(2)
        } else if (p.match(/^(case) /mg)) {
            userName = p.slice(5)
        } else if (p.match(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg)) {
            const ss = p.split(':')
            const hyp: InteractiveHypothesisBundle = {
                isType: false,
                isInstance: false,
                names: ss[0].split(' ')
                    .map(s => s.trim())
                    .filter(s => s.length !== 0),
                type: { text: ss.slice(1).join(':').trim() }
            }
            hyps.push(hyp)
        }
    }

    return { hyps, type: { text: type }, userName }
}

export function updatePlainGoals(g: PlainGoal): InteractiveGoals {
    const gs = getGoals(g)
    return {
        goals: gs.map(transformGoalToInteractive)
    }
}

export function updateTermGoal(g: PlainTermGoal): InteractiveGoal {
    return transformGoalToInteractive(g.goal)
}
