import { DisplayMode } from '../src/typings';
import * as React from 'react';
import { colorizeMessage, escapeHtml } from './util';
import { ConfigContext } from './index';

interface GoalProps {
    goalState: string;
}

export function Goal(props: GoalProps): JSX.Element {
    const config = React.useContext(ConfigContext);
    if (!props.goalState) { return null; }
    const reFilters = config.infoViewTacticStateFilters || [];
    const filterIndex = config.filterIndex ?? -1;
    let goalString = props.goalState.replace(/^(no goals)/mg, 'goals accomplished')
    goalString = RegExp('^\\d+ goals|goals accomplished', 'mg').test(goalString) ? goalString : '1 goal\n'.concat(goalString);
    if (!(reFilters.length === 0 || filterIndex === -1)) {
        // this regex splits the goal state into (possibly multi-line) hypothesis and goal blocks
        // by keeping indented lines with the most recent non-indented line
        goalString = goalString.match(/(^(?!  ).*\n?(  .*\n?)*)/mg).map((line) => line.trim())
            .filter((line) => {
                const filt = reFilters[filterIndex];
                const test = (new RegExp(filt.regex, filt.flags)).exec(line) !== null;
                return filt.match ? test : !test;
            }).join('\n');
    }
    goalString = colorizeMessage(escapeHtml(goalString));
    return <details open><summary className="mv2 pointer">Tactic State</summary>
        <pre className="font-code ml3" dangerouslySetInnerHTML={{ __html: goalString }} />
    </details>
}
