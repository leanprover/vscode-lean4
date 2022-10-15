import * as React from 'react';
import type { Location, Diagnostic } from 'vscode-languageserver-protocol';

import { Goals as GoalsUi, Goal as GoalUi, goalsToString, GoalFilterState } from './goals';
import { basename, DocumentPosition, RangeHelpers, useEvent, usePausableState, discardMethodNotFound, mapRpcError, useAsyncWithTrigger, PausableProps } from './util';
import { Details } from './collapsing';
import { ConfigContext, EditorContext, LspDiagnosticsContext, ProgressContext } from './contexts';
import { lspDiagToInteractive, MessagesList } from './messages';
import { getInteractiveGoals, getInteractiveTermGoal, InteractiveDiagnostic, InteractiveGoal,
    InteractiveGoals, UserWidgets, Widget_getWidgets, RpcSessionAtPos, isRpcError, RpcErrorCode, getInteractiveDiagnostics } from '@leanprover/infoview-api';
import { WithTooltipOnHover } from './tooltips'
import { UserWidget } from './userWidget'
import { RpcContext, useRpcSessionAtPos } from './rpcSessions';

type InfoStatus = 'updating' | 'error' | 'ready';
type InfoKind = 'cursor' | 'pin';

interface InfoPinnable {
    kind: InfoKind;
    /** Takes an argument for caching reasons, but should only ever (un)pin itself. */
    onPin: (pos: DocumentPosition) => void;
}

interface InfoStatusBarProps extends InfoPinnable, PausableProps {
    pos: DocumentPosition;
    status: InfoStatus;
    copyGoalToComment?: () => void;
    triggerUpdate: () => Promise<void>;
}

const InfoStatusBar = React.memo((props: InfoStatusBarProps) => {
    const { kind, onPin, status, pos, isPaused, copyGoalToComment, setPaused, triggerUpdate } = props;

    const ec = React.useContext(EditorContext);

    const statusColTable: {[T in InfoStatus]: string} = {
        'updating': 'gold ',
        'error': 'dark-red ',
        'ready': '',
    }
    const statusColor = statusColTable[status];
    const locationString = `${basename(pos.uri)}:${pos.line+1}:${pos.character}`;
    const isPinned = kind === 'pin';

    return (
    <summary style={{transition: 'color 0.5s ease'}} className={'mv2 pointer ' + statusColor}>
        {locationString}
        {isPinned && !isPaused && ' (pinned)'}
        {!isPinned && isPaused && ' (paused)'}
        {isPinned && isPaused && ' (pinned and paused)'}
        <span className="fr">
            {copyGoalToComment &&
                <a className="link pointer mh2 dim codicon codicon-quote"
                   data-id="copy-goal-to-comment"
                   onClick={e => { e.preventDefault(); copyGoalToComment(); }}
                   title="copy state to comment" />}
            {isPinned &&
                <a className="link pointer mh2 dim codicon codicon-go-to-file"
                   data-id="reveal-file-location"
                   onClick={e => { e.preventDefault(); void ec.revealPosition(pos); }}
                   title="reveal file location" />}
            <a className={'link pointer mh2 dim codicon ' + (isPinned ? 'codicon-pinned ' : 'codicon-pin ')}
                data-id="toggle-pinned"
                onClick={e => { e.preventDefault(); onPin(pos); }}
                title={isPinned ? 'unpin' : 'pin'} />
            <a className={'link pointer mh2 dim codicon ' + (isPaused ? 'codicon-debug-continue ' : 'codicon-debug-pause ')}
               data-id="toggle-paused"
               onClick={e => { e.preventDefault(); setPaused(!isPaused); }}
               title={isPaused ? 'continue updating' : 'pause updating'} />
            <a className="link pointer mh2 dim codicon codicon-refresh"
               data-id="update"
               onClick={e => { e.preventDefault(); void triggerUpdate(); }}
               title="update"/>
        </span>
    </summary>
    );
})

interface InfoDisplayContentProps extends PausableProps {
    pos: DocumentPosition;
    messages: InteractiveDiagnostic[];
    goals?: InteractiveGoals;
    termGoal?: InteractiveGoal;
    error?: string;
    userWidgets?: UserWidgets;
    triggerUpdate: () => Promise<void>;
}

const InfoDisplayContent = React.memo((props: InfoDisplayContentProps) => {
    const {pos, messages, goals, termGoal, error, userWidgets, triggerUpdate, isPaused, setPaused} = props;

    const widgets = userWidgets && userWidgets.widgets
    const hasWidget = (widgets !== undefined) && (widgets.length > 0)

    const nothingToShow = !error && !goals && !termGoal && messages.length === 0 && !hasWidget;

    const hasError = !!error;
    const hasGoals = !!goals;
    const hasTermGoal = !!termGoal;
    const hasMessages = messages.length !== 0;

    const [goalFilters, setGoalFilters] = React.useState<GoalFilterState>(
        { reverse: false, isType: true, isInstance: true, isHiddenAssumption: true});
    const sortClasses = 'link pointer mh2 dim codicon fr ' + (goalFilters.reverse ? 'codicon-arrow-up ' : 'codicon-arrow-down ');
    const sortButton = <a className={sortClasses} title="reverse list" onClick={e => {
        setGoalFilters(s => {
            return { ...s, reverse: !s.reverse }
        } ); }
    } />

    const filterMenu = <span>
        <a className='link pointer tooltip-menu-content' onClick={e => {
            setGoalFilters(s => {
                return { ...s, isType: !s.isType }
            } ); }}>
                <span className={'tooltip-menu-icon codicon ' + (goalFilters.isType ? 'codicon-check ' : 'codicon-blank ')}>&nbsp;</span>
                <span className='tooltip-menu-text '>types</span>
        </a>
        <br/>
        <a className='link pointer tooltip-menu-content' onClick={e => {
            setGoalFilters(s => {
                return { ...s, isInstance: !s.isInstance }
            } ); }}>
                <span className={'tooltip-menu-icon codicon ' + (goalFilters.isInstance ? 'codicon-check ' : 'codicon-blank ')}>&nbsp;</span>
                <span className='tooltip-menu-text '>instances</span>
        </a>
        <br/>
        <a className='link pointer tooltip-menu-content' onClick={e => {
            setGoalFilters(s => {
                return { ...s, isHiddenAssumption: !s.isHiddenAssumption }
            } ); }}>
                <span className={'tooltip-menu-icon codicon ' + (goalFilters.isHiddenAssumption ? 'codicon-check ' : 'codicon-blank ')}>&nbsp;</span>
                <span className='tooltip-menu-text '>hidden assumptions</span>
        </a>
    </span>
    const filterButton = <span className='fr'>
        <WithTooltipOnHover mkTooltipContent={() => {return filterMenu}}>
            <a className={'link pointer mh2 dim codicon ' + ((!goalFilters.isInstance || !goalFilters.isType || !goalFilters.isHiddenAssumption) ? 'codicon-filter-filled ': 'codicon-filter ')}/>
        </WithTooltipOnHover></span>

    /* Adding {' '} to manage string literals properly: https://reactjs.org/docs/jsx-in-depth.html#string-literals-1 */
    return <>
        <div className="ml1">
            {hasError &&
                <div className="error" key="errors">
                    Error updating:{' '}{error}.
                    <a className="link pointer dim" onClick={e => { e.preventDefault(); void triggerUpdate(); }}>{' '}Try again.</a>
                </div>}
            <div style={{display: hasGoals ? 'block' : 'none'}} key="goals">
                <Details initiallyOpen>
                    <summary className="mv2 pointer">
                        Tactic state {sortButton} {filterButton}
                    </summary>
                    <div className='ml1'>
                        {hasGoals && <GoalsUi goals={goals} filter={goalFilters} />}
                    </div>
                </Details>
            </div>
            <div style={{display: hasTermGoal ? 'block' : 'none'}} key="term-goal">
                <Details initiallyOpen>
                    <summary className="mv2 pointer">
                        Expected type {sortButton} {filterButton}
                    </summary>
                    <div className='ml1'>
                        {hasTermGoal && <GoalUi goal={termGoal} filter={goalFilters} />}
                    </div>
                </Details>
            </div>
            {widgets && widgets.map(widget =>
                <div style={{display: hasWidget ? 'block' : 'none'}}
                     key={`widget::${widget.id}::${widget.range?.toString()}`}>
                    <Details initiallyOpen>
                        <summary className="mv2 pointer">
                            {widget.name}
                        </summary>
                        <div className="ml1">
                             <UserWidget pos={pos} widget={widget}/>
                        </div>
                    </Details>
                </div>
            )}
            <div style={{display: hasMessages ? 'block' : 'none'}} key="messages">
                <Details initiallyOpen>
                    <summary className="mv2 pointer">
                        Messages ({messages.length})
                    </summary>
                    <div className="ml1">
                        <MessagesList uri={pos.uri} messages={messages} />
                    </div>
                </Details>
            </div>
            {nothingToShow && (
                isPaused ?
                    /* Adding {' '} to manage string literals properly: https://reactjs.org/docs/jsx-in-depth.html#string-literals-1 */
                    <span>Updating is paused.{' '}
                        <a className="link pointer dim" onClick={e => { e.preventDefault(); void triggerUpdate(); }}>Refresh</a>
                        {' '}or <a className="link pointer dim" onClick={e => { e.preventDefault(); setPaused(false); }}>resume updating</a>
                        {' '}to see information.
                    </span> :
                    'No info found.')}
        </div>
    </>
})

interface InfoDisplayProps {
    pos: DocumentPosition;
    status: InfoStatus;
    messages: InteractiveDiagnostic[];
    goals?: InteractiveGoals;
    termGoal?: InteractiveGoal;
    error?: string;
    userWidgets?: UserWidgets;
    rpcSess: RpcSessionAtPos;
    triggerUpdate: () => Promise<void>;
}

/** Displays goal state and messages. Can be paused. */
function InfoDisplay(props0: InfoDisplayProps & InfoPinnable) {
    // Used to update the paused state *just once* if it is paused,
    // but a display update is triggered
    const [shouldRefresh, setShouldRefresh] = React.useState<boolean>(false);
    const [{ isPaused, setPaused }, props, propsRef] = usePausableState(false, props0);
    if (shouldRefresh) {
        propsRef.current = props0;
        setShouldRefresh(false);
    }
    const triggerDisplayUpdate = async () => {
        await props0.triggerUpdate();
        setShouldRefresh(true);
    };

    const {kind, goals, rpcSess} = props;

    const ec = React.useContext(EditorContext);
    let copyGoalToComment: (() => void) | undefined
    if (goals) copyGoalToComment = () => void ec.copyToComment(goalsToString(goals));

    // If we are the cursor infoview, then we should subscribe to
    // some commands from the editor extension
    const isCursor = kind === 'cursor';
    useEvent(ec.events.requestedAction, act => {
        if (!isCursor) return;
        if (act.kind !== 'copyToComment') return;
        if (copyGoalToComment) copyGoalToComment();
    }, [goals]);
    useEvent(ec.events.requestedAction, act => {
        if (!isCursor) return;
        if (act.kind !== 'togglePaused') return;
        setPaused(isPaused => !isPaused);
    });

    return (
    <RpcContext.Provider value={rpcSess}>
    <Details initiallyOpen>
        <InfoStatusBar {...props} triggerUpdate={triggerDisplayUpdate} isPaused={isPaused} setPaused={setPaused} copyGoalToComment={copyGoalToComment} />
        <InfoDisplayContent {...props} triggerUpdate={triggerDisplayUpdate} isPaused={isPaused} setPaused={setPaused} />
    </Details>
    </RpcContext.Provider>
    );
}

/**
 * Note: in the cursor view, we have to keep the cursor position as part of the component state
 * to avoid flickering when the cursor moved. Otherwise, the component is re-initialised and the
 * goal states reset to `undefined` on cursor moves.
 */
export type InfoProps = InfoPinnable & { pos?: DocumentPosition };

/** Fetches info from the server and renders an {@link InfoDisplay}. */
export function Info(props: InfoProps) {
    if (props.kind === 'cursor') return <InfoAtCursor {...props} />
    else return <InfoAux {...props} pos={props.pos} />
}

function InfoAtCursor(props: InfoProps) {
    const ec = React.useContext(EditorContext);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const [curLoc, setCurLoc] = React.useState<Location>(ec.events.changedCursorLocation.current!);
    useEvent(ec.events.changedCursorLocation, loc => loc && setCurLoc(loc), []);
    const pos = { uri: curLoc.uri, ...curLoc.range.start };
    return <InfoAux {...props} pos={pos} />
}

function useIsProcessingAt(p: DocumentPosition): boolean {
    const allProgress = React.useContext(ProgressContext);
    const processing = allProgress.get(p.uri);
    if (!processing) return false;
    return processing.some(i => RangeHelpers.contains(i.range, p));
}

function InfoAux(props: InfoProps) {
    const config = React.useContext(ConfigContext)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pos = props.pos!
    const rpcSess = useRpcSessionAtPos(pos)

    // Compute the LSP diagnostics at this info's position. We try to ensure that if these remain
    // the same, then so does the identity of `lspDiagsHere` so that it can be used as a dep.
    const lspDiags = React.useContext(LspDiagnosticsContext)
    const [lspDiagsHere, setLspDiagsHere] = React.useState<Diagnostic[]>([])
    React.useEffect(() => {
        // Note: the curly braces are important. https://medium.com/geekculture/react-uncaught-typeerror-destroy-is-not-a-function-192738a6e79b
        setLspDiagsHere(diags0 => {
            const diagPred = (d: Diagnostic) =>
                RangeHelpers.contains(d.range, pos, config.infoViewAllErrorsOnLine)
            const newDiags = (lspDiags.get(pos.uri) || []).filter(diagPred)
            if (newDiags.length === diags0.length && newDiags.every((d, i) => d === diags0[i])) return diags0
            return newDiags
        })
    }), [lspDiags, pos.uri, pos.line, pos.character, config.infoViewAllErrorsOnLine])

    const serverIsProcessing = useIsProcessingAt(pos)

    // This is a virtual dep of the info-requesting function. It is bumped whenever the Lean server
    // indicates that another request should be made. Bumping it dirties the dep state of
    // `useAsyncWithTrigger` below, causing the `useEffect` lower down in this component to
    // make the request. We cannot simply call `triggerUpdateCore` because `useAsyncWithTrigger`
    //  does not support reentrancy like that.
    const [updaterTick, setUpdaterTick] = React.useState<number>(0)

    // For atomicity, we use a single update function that fetches all the info at `pos` at once.
    type InfoRequestResult = [InteractiveGoals | undefined, InteractiveGoal | undefined, UserWidgets | undefined, InteractiveDiagnostic[]]
    const [state, triggerUpdateCore] = useAsyncWithTrigger(() => new Promise<InfoRequestResult>((resolve, reject) => {
        const goalsReq = getInteractiveGoals(rpcSess, DocumentPosition.toTdpp(pos));
        const termGoalReq = getInteractiveTermGoal(rpcSess, DocumentPosition.toTdpp(pos))
        const widgetsReq = Widget_getWidgets(rpcSess, pos).catch(discardMethodNotFound)
        const messagesReq = getInteractiveDiagnostics(rpcSess, {start: pos.line, end: pos.line+1})
            // fall back to non-interactive diagnostics when lake fails
            // (see https://github.com/leanprover/vscode-lean4/issues/90)
            .then(diags => diags.length === 0 ? lspDiagsHere.map(lspDiagToInteractive) : diags)

        // While `lake print-paths` is running, the output of Lake is shown as
        // info diagnostics on line 1.  However, all RPC requests block until
        // Lake is finished, so we don't see these diagnostics while Lake is
        // building.  Therefore we show the LSP diagnostics on line 1 if the
        // server does not respond within half a second.
        if (pos.line === 0 && lspDiagsHere.length) {
            setTimeout(() =>
                resolve([undefined, undefined, undefined, lspDiagsHere.map(lspDiagToInteractive)]),
                500)
        }

        // NB: it is important to await await reqs at once, otherwise
        // if both throw then one exception becomes unhandled.
        Promise.all([goalsReq, termGoalReq, widgetsReq, messagesReq]).then(
            val => resolve(val),
            ex => {
                if (ex?.code === RpcErrorCode.ContentModified ||
                    ex?.code === RpcErrorCode.RpcNeedsReconnect) {
                    // Document has been changed since we made the request, or we need to reconnect
                    // to the RPC sessions. Try again.
                    setUpdaterTick(t => t + 1)
                    reject('retry')
                }
                reject(ex)
            }
        )
    }), [updaterTick, pos.uri, pos.line, pos.character, serverIsProcessing, lspDiagsHere])

    // We use a timeout to debounce info requests. Whenever a request is already scheduled
    // but something happens that warrants a request for newer info, we cancel the old request
    // and schedule just the new one.
    const updaterTimeout = React.useRef<number>()
    const clearUpdaterTimeout = () => {
        if (updaterTimeout.current) {
            window.clearTimeout(updaterTimeout.current)
            updaterTimeout.current = undefined
        }
    }
    const triggerUpdate = React.useCallback(() => new Promise<void>(resolve => {
        clearUpdaterTimeout()
        const tm = window.setTimeout(() => {
            void triggerUpdateCore().then(resolve)
            updaterTimeout.current = undefined
        }, 50)
        // Hack: even if the request is cancelled, the promise should resolve so that no `await`
        // is left waiting forever. We ensure this happens in a simple way.
        window.setTimeout(resolve, 50)
        updaterTimeout.current = tm
    }), [triggerUpdateCore])

    const [displayProps, setDisplayProps] = React.useState<InfoDisplayProps>({
        pos,
        status: 'updating',
        messages: [],
        goals: undefined,
        termGoal: undefined,
        error: undefined,
        userWidgets: undefined,
        rpcSess,
        triggerUpdate
    })

    // Propagates changes in the state of async info requests to the display props,
    // and re-requests info if needed.
    // This effect triggers new requests for info whenever need. It also propagates changes
    // in the state of the `useAsyncWithTrigger` to the displayed props.
    React.useEffect(() => {
        if (state.state === 'notStarted')
            void triggerUpdate()
        else if (state.state === 'loading')
            setDisplayProps(dp => ({ ...dp, status: 'updating' }))
        else if (state.state === 'resolved') {
            const [goals, termGoal, userWidgets, messages] = state.value
            setDisplayProps({
                pos,
                status: 'ready',
                messages,
                goals,
                termGoal,
                error: undefined,
                userWidgets,
                rpcSess,
                triggerUpdate
            })
        } else if (state.state === 'rejected' && state.error !== 'retry') {
            let errorString = ''
            if (typeof state.error === 'string') {
                errorString = state.error
            } else if (isRpcError(state.error)) {
                errorString = mapRpcError(state.error).message
            } else if (state.error instanceof Error) {
                errorString = state.error.toString()
            } else {
                errorString = `Unrecognized error: ${JSON.stringify(state.error)}`
            }

            setDisplayProps({
                pos,
                status: 'error',
                messages: lspDiagsHere.map(lspDiagToInteractive),
                goals: undefined,
                termGoal: undefined,
                error: `Error fetching goals: ${errorString}`,
                userWidgets: undefined,
                rpcSess,
                triggerUpdate
            })
        }
    }, [state])

    return <InfoDisplay kind={props.kind} onPin={props.onPin} {...displayProps} />
}
