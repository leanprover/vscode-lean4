import * as React from 'react'

import { useToggleableTooltip } from './tooltips'
import { LogicalDomContext, useLogicalDomObserver, useOnClickOutside } from './util'

const whatsThisContent = (
    <div className="tooltip-code-content">
        <p>
            The Lean InfoView follows your text cursor, updating as the&nbsp;cursor moves. It shows proof goals,
            the&nbsp;expected type, and messages at the&nbsp;current position.
        </p>
        <p>
            Hover over an expression to see its type and&nbsp;documentation. Ctrl/Cmd-click an expression to go to its
            definition. Use the <span className="font-codicon codicon codicon-pin" /> and{' '}
            <span className="font-codicon codicon codicon-debug-pause" /> icons to keep a&nbsp;position in view. Write{' '}
            <a href="https://lean-lang.org/doc/reference/latest/Interacting-with-Lean/#widgets">widgets</a> to extend
            what's shown in the&nbsp;InfoView with additional information and visualizations.
        </p>
        <p>
            Learn more in the&nbsp;
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
