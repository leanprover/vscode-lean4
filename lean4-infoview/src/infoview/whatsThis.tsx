import * as React from 'react'

import { useToggleableTooltip } from './tooltips'
import { LogicalDomContext, useLogicalDomObserver, useOnClickOutside } from './util'

const whatsThisContent = (
    <div>
        <p>
            The Lean InfoView shows proof goals, expected types of expressions, messages, and other information about
            the source file.
        </p>
        <p>
            You may use <a href="https://lean-lang.org/doc/reference/latest/Interacting-with-Lean/#widgets">widgets</a>{' '}
            to extend what's shown in the InfoView with additional information and visualizations.
        </p>
        <p>
            Learn more about the InfoView in the{' '}
            <a href="https://github.com/leanprover/vscode-lean4/blob/master/vscode-lean4/manual/manual.md#infoview">
                VS Code extension manual
            </a>
            .
        </p>
    </div>
)

/** A button in the lower-left corner of the InfoView that toggles a popover explaining the InfoView. */
export function WhatsThisButton() {
    const ref = React.useRef<HTMLSpanElement>(null)
    const [logicalSpanElt, logicalDomStorage] = useLogicalDomObserver(ref)
    const tt = useToggleableTooltip(ref, whatsThisContent)
    useOnClickOutside(logicalSpanElt, tt.onClickOutside, tt.tooltipDisplayed)

    return (
        <LogicalDomContext.Provider value={logicalDomStorage}>
            <span ref={ref} className="whats-this-button">
                {tt.tooltip}
                <a
                    className="link pointer dim codicon codicon-question"
                    onClick={_ => tt.setTooltipDisplayed(!tt.tooltipDisplayed)}
                    title="What's this?"
                />
            </span>
        </LogicalDomContext.Provider>
    )
}
