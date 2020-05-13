import * as React from 'react';

// https://stackoverflow.com/questions/6234773/can-i-escape-html-special-chars-in-javascript
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function colorizeMessage(goal: string): string {
    return goal
        .replace(/^([|⊢]) /mg, '<strong class="goal-vdash">$1</strong> ')
        .replace(/^(\d+ goals|1 goal)/mg, '<strong class="goal-goals">$1</strong>')
        .replace(/^(context|state):/mg, '<strong class="goal-goals">$1</strong>:')
        .replace(/^(case) /mg, '<strong class="goal-case">$1</strong> ')
        .replace(/^([^:\n< ][^:\n⊢{[(⦃]*) :/mg, '<strong class="goal-hyp">$1</strong> :');
}

export function basename(path) { return path.split(/[\\/]/).pop(); }

interface CollapsibleProps {
    title: string;
    children;
    className?: string;
    headerClassName?: string;
    toolbar?;
}
export function Collapsible(props: CollapsibleProps) {
    const [collapsed, set] = React.useState(false);
    return <div className={props.className}>
        <h1 className={'collapsible-header'}>
            <a className='pointer dim link pa1 ma1 bn'
            onClick={() => set(!collapsed)}>
                {collapsed ? '⮞' : '⮟'}
            </a>,
            <span className={props.headerClassName}>{props.title}</span>,
            {toolbar &&
                <span className="fr">
                    {toolbar}
                </span>
            }
        </h1>
        <div className='ml1' hidden={collapsed}>
            {props.children}
        </div>
    </div>
}
