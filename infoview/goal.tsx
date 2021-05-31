import * as React from 'react';
import { escapeHtml } from './util';
import { ConfigContext } from './index';
import { PlainGoal, PlainTermGoal } from '../src/leanclientTypes';

interface GoalProps {
    plainGoals: PlainGoal;
}

export function getGoals(plainGoals: PlainGoal): string[] {
    if (plainGoals.goals) return plainGoals.goals
    const goals: string[] = [];
    const r = /```lean\n([^`]*)```/g
    let match: RegExpExecArray
    const unformatted = plainGoals.rendered;
    do {
        match = r.exec(unformatted)
        if (match) {
            goals.push(match[1])
        }
    } while (match)
    return goals;
}

function emphasizeMessage(goal: string): string {
    return goal
        .replace(/([^`~@$%^&*()-=+\[{\]}⟨⟩⦃⦄⟦⟧⟮⟯‹›\\|;:",.\/\s]+)(✝)([¹²³⁴-⁹⁰]*)/g, '<span class="goal-inaccessible">$1$2$3</span>')
        .replace(/^(⊢) /mg, '<strong class="goal-vdash">$1</strong> ')
        .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
        .replace(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg, '<strong class="goal-hyp">$1</strong> :')
}

export function Goal({plainGoals}: GoalProps): JSX.Element {
    const config = React.useContext(ConfigContext);
    const reFilters = config.infoViewTacticStateFilters || [];
    const [filterIndex, setFilterIndex] = React.useState<number>(config.filterIndex ?? -1);
    if (!plainGoals) return null;

    let goals = getGoals(plainGoals);

    if (!(reFilters.length === 0 || filterIndex === -1)) {
        goals = goals.map((g) =>
            // this regex splits the goal state into (possibly multi-line) hypothesis and goal blocks
            // by keeping indented lines with the most recent non-indented line
            g.match(/(^(?!  ).*\n?(  .*\n?)*)/mg).map((line) => line.trim())
                .filter((line) => {
                    const filt = reFilters[filterIndex];
                    const test = (new RegExp(filt.regex, filt.flags)).exec(line) !== null;
                    return filt.match ? test : !test;
                }).join('\n'));
    }

    goals = goals.map((g) => emphasizeMessage(escapeHtml(g)));

    return <div>
        {reFilters.length !== 0 && <div className="fr">
            <label>filter: </label>
            <select value={filterIndex} onChange={(e) => setFilterIndex(Number(e.target.value))}>
                <option value={-1}>none</option>
                {reFilters.map(({name, match, regex, flags}, i) =>
                    <option value={i}>{name || `${match ? 'show ' : 'hide '}/${regex}/${flags}`}</option>)}
            </select>
        </div>}
        {!goals.length ? 'goals accomplished' :
            goals.map((g, i) =>
                <pre key={i} className="font-code" style={{whiteSpace: 'pre-wrap'}} dangerouslySetInnerHTML={{ __html: g }} />)}
    </div>

}

export function TermGoal({termGoal}: {termGoal: PlainTermGoal}): JSX.Element {
    if (!termGoal?.goal) return null;
    // TODO
    return Goal({plainGoals: {rendered: null, goals: [termGoal.goal]}});
}
