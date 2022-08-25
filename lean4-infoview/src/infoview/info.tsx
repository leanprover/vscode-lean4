import * as React from 'react';
import type { Location } from 'vscode-languageserver-protocol';

import { Goals as GoalsUi, Goal as GoalUi, goalsToString, GoalFilterState } from './goals';
import { basename, DocumentPosition, RangeHelpers, useEvent, usePausableState, useClientNotificationEffect, discardMethodNotFound, mapRpcError } from './util';
import { Details } from './collapsing';
import { ConfigContext, EditorContext, LspDiagnosticsContext, ProgressContext, VersionContext } from './contexts';
import { lspDiagToInteractive, MessagesList } from './messages';
import { getInteractiveGoals, getInteractiveTermGoal, InteractiveDiagnostic, InteractiveGoal,
    InteractiveGoals, UserWidgets, Widget_getWidgets, RpcSessionAtPos, isRpcError, RpcErrorCode, getInteractiveDiagnostics } from '@leanprover/infoview-api';
import { updatePlainGoals, updateTermGoal } from './goalCompat';
import { WithTooltipOnHover } from './tooltips'
import { UserWidget } from './userWidget'
import { RpcContext, useRpcSessionAtPos } from './rpcSessions';

type InfoStatus = 'loading' | 'updating' | 'error' | 'ready';
type InfoKind = 'cursor' | 'pin';

interface InfoPinnable {
    kind: InfoKind;
    /** Takes an argument for caching reasons, but should only ever (un)pin itself. */
    onPin: (pos: DocumentPosition) => void;
}

interface InfoStatusBarProps extends InfoPinnable {
    pos: DocumentPosition;
    status: InfoStatus;
    isPaused: boolean;
    copyGoalToComment?: () => void;
    setPaused: (p: boolean) => void;
    triggerUpdate: () => Promise<void>;
}

export function InfoStatusBar(props: InfoStatusBarProps) {
    const { kind, onPin, status, pos, isPaused, copyGoalToComment, setPaused, triggerUpdate } = props;

    const ec = React.useContext(EditorContext);

    const statusColTable: {[T in InfoStatus]: string} = {
        'loading': 'gold ',
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
}

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
export function InfoDisplay(props0: InfoDisplayProps & InfoPinnable) {
    // Used to update the paused state once if a display update is triggered
    const [shouldRefresh, setShouldRefresh] = React.useState<boolean>(false);
    const [isPaused, setPaused, props, propsRef] = usePausableState(false, props0);
    if (shouldRefresh) {
        propsRef.current = props0;
        setShouldRefresh(false);
    }
    const triggerDisplayUpdate = async () => {
        await props0.triggerUpdate();
        setShouldRefresh(true);
    };
    const [goalFilters, setGoalFilters] = React.useState<GoalFilterState>(
        { reverse: false, isType: true, isInstance: true, isHiddenAssumption: true});

    const {kind, pos, messages, goals, termGoal, error, userWidgets, rpcSess} = props;

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

    const widgets = userWidgets && userWidgets.widgets
    const hasWidget = (widgets !== undefined) && (widgets.length > 0)

    const nothingToShow = !error && !goals && !termGoal && messages.length === 0 && !hasWidget;

    const hasError = !!error;
    const hasGoals = !!goals;
    const hasTermGoal = !!termGoal;
    const hasMessages = messages.length !== 0;
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
    return (
    <RpcContext.Provider value={rpcSess}>
    <Details initiallyOpen>
        <InfoStatusBar {...props} triggerUpdate={triggerDisplayUpdate} isPaused={isPaused} setPaused={setPaused} copyGoalToComment={copyGoalToComment} />
        <div className="ml1">
            {hasError &&
                <div className="error" key="errors">
                    Error updating:{' '}{error}.
                    <a className="link pointer dim" onClick={e => { e.preventDefault(); void triggerDisplayUpdate(); }}>{' '}Try again.</a>
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
                        <a className="link pointer dim" onClick={e => { e.preventDefault(); void triggerDisplayUpdate(); }}>Refresh</a>
                        {' '}or <a className="link pointer dim" onClick={e => { e.preventDefault(); setPaused(false); }}>resume updating</a>
                        {' '}to see information.
                    </span> :
                    'No info found.')}
        </div>
    </Details>
    </RpcContext.Provider>
    );
}

function useIsProcessingAt(p: DocumentPosition): boolean {
    const allProgress = React.useContext(ProgressContext);
    const processing = allProgress.get(p.uri);
    if (!processing) return false;
    return processing.some(i => RangeHelpers.contains(i.range, p));
}

/**
 * returns function that triggers `cb`
 * - but only `ms` milliseconds after the first call
 * - and not more often than once every `ms` milliseconds
 */
function useDelayedThrottled(ms: number, cb: () => Promise<void>): () => Promise<void> {
    const waiting = React.useRef<boolean>(false);
    const callbackRef = React.useRef<() => Promise<void>>();
    callbackRef.current = cb;
    return React.useCallback(async () => {
        if (!waiting.current) {
            waiting.current = true;
            const promise = new Promise((resolved, rejected) => {
                setTimeout(() => {
                    waiting.current = false;
                    if (callbackRef.current) callbackRef.current().then(resolved, rejected);
                }, ms);
            });
            await promise;
        }
    }, [ms]);
}

/**
 * Note: in the cursor view, we have to keep the cursor position as part of the component state
 * to avoid flickering when the cursor moved. Otherwise, the component is re-initialised and the
 * goal states reset to `undefined` on cursor moves.
 */
export type InfoProps = InfoPinnable & { pos?: DocumentPosition };

/** Fetches info from the server and renders an {@link InfoDisplay}. */
export function Info(props: InfoProps) {
    const ec = React.useContext(EditorContext);

    // Note: `kind` may not change throughout the lifetime of an `Info` component,
    // otherwise the hooks will differ.
    const pos = props.kind === 'cursor' ?
        (() => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const [curLoc, setCurLoc] = React.useState<Location>(ec.events.changedCursorLocation.current!);
            useEvent(ec.events.changedCursorLocation, loc => loc && setCurLoc(loc), []);
            return { uri: curLoc.uri, ...curLoc.range.start };
        })()
        : props.pos;

    return (
        <InfoAux {...props} pos={pos} />
    );
}

function InfoAux(props: InfoProps) {
    const ec = React.useContext(EditorContext)
    const sv = React.useContext(VersionContext)

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pos = props.pos!;

    const rpcSess = useRpcSessionAtPos(pos);

    const lspDiags = React.useContext(LspDiagnosticsContext);
    const config = React.useContext(ConfigContext);

    const serverIsProcessing = useIsProcessingAt(pos);

    // We encapsulate `InfoDisplay` props in a single piece of state for atomicity
    const [displayProps, setDisplayProps] = React.useState<Omit<InfoDisplayProps, 'triggerUpdate'>>(
        () => ({ pos, goals: undefined, termGoal: undefined, error: undefined, rpcSess, userWidgets: undefined, messages: [], status: 'loading' }));

    // Two counters used to ensure monotonic updates
    const tick = React.useRef(0) // Incremented when an update is triggered
    const displayPropsTick = React.useRef(0) // Assigned when setDisplayProps is called
    // If displayPropsTick.current < tick.current, then an update is in flight.

    const triggerUpdate = useDelayedThrottled(serverIsProcessing ? 250 : 50, async () => {
        tick.current += 1
        const tickAtStart = tick.current

        setDisplayProps(props => ({...props, status: 'updating'}));

        const diagPred = (d: InteractiveDiagnostic) =>
            RangeHelpers.contains(d.range, pos, config.infoViewAllErrorsOnLine);
        const lspDiagsHere = (lspDiags.get(pos.uri) || []).map(lspDiagToInteractive).filter(diagPred)

        let goalsReq: Promise<InteractiveGoals | undefined>
        let termGoalReq: Promise<InteractiveGoal | undefined>
        let widgetsReq: Promise<UserWidgets | undefined>
        let messagesReq: Promise<InteractiveDiagnostic[]>

        if (sv?.hasWidgetsV1()) {
            goalsReq = getInteractiveGoals(rpcSess, DocumentPosition.toTdpp(pos));
            termGoalReq = getInteractiveTermGoal(rpcSess, DocumentPosition.toTdpp(pos));
            widgetsReq = Widget_getWidgets(rpcSess, pos).catch(discardMethodNotFound);
            messagesReq = getInteractiveDiagnostics(rpcSess, {start: pos.line, end: pos.line+1})
                // fall back to dumb diagnostics when lake fails (see https://github.com/leanprover/vscode-lean4/issues/90)
                .then(diags => diags.length === 0 ? lspDiagsHere : diags);
        } else {
            goalsReq = ec.requestPlainGoal(pos).then(gs => gs && updatePlainGoals(gs))
            termGoalReq = ec.requestPlainTermGoal(pos).then(g => g && updateTermGoal(g))
                .catch(() => undefined) // ignore error on Lean version that don't support term goals yet
            widgetsReq = Promise.resolve(undefined)
            messagesReq = Promise.resolve(lspDiagsHere)
        }

        // While `lake print-paths` is running, the output of Lake is shown as
        // info diagnostics on line 1.  However, all RPC requests block until
        // Lake is finished, so we don't see these diagnostics while Lake is
        // building.  Therefore we show the LSP diagnostics on line 1 if the
        // server does not respond within half a second.
        if (pos.line === 0 && lspDiagsHere.length) {
            setTimeout(() => {
                if (tickAtStart > displayPropsTick.current) {
                    setDisplayProps({ pos, messages: lspDiagsHere, rpcSess, status: 'updating' })
                    displayPropsTick.current = tickAtStart
                }
            }, 500)
        }

        let newProps: Omit<InfoDisplayProps, 'triggerUpdate'>
        try {
            // NB: it is important to await both reqs at once, otherwise
            // if both throw then one exception becomes unhandled.
            const [goals, termGoal, userWidgets, messages] = await Promise.all([goalsReq, termGoalReq, widgetsReq, messagesReq]);
            newProps = { pos, messages, goals, termGoal, userWidgets, rpcSess, status: 'ready' }
        } catch (ex: any) {
            if (ex?.code === RpcErrorCode.ContentModified) {
                // Document has been changed since we made the request, try again
                return void triggerUpdate();
            } else if (ex?.code === RpcErrorCode.RpcNeedsReconnect) {
                // Need to reconnect to RPC session
                return void triggerUpdate();
            }

            let errorString : string;
            if (typeof ex === 'string') {
                errorString = ex
            } else if (isRpcError(ex)) {
                errorString = mapRpcError(ex).message
            } else if (ex instanceof Error) {
                errorString = ex.toString()
            } else {
                errorString = `Unrecognized error: ${JSON.stringify(ex)}`
            }

            newProps = {
                pos,
                messages: lspDiagsHere,
                goals: undefined,
                termGoal: undefined,
                error: `Error fetching goals: ${errorString}`,
                rpcSess,
                status: 'error',
            }
        }

        if (tickAtStart < displayPropsTick.current) return;
        displayPropsTick.current = tickAtStart;
        if (tickAtStart < tick.current) newProps.status = 'updating';
        setDisplayProps(newProps)
    });

    React.useEffect(() => void triggerUpdate(), [pos.uri, pos.line, pos.character, lspDiags, serverIsProcessing]);

    return (
        <InfoDisplay {...props} {...displayProps} triggerUpdate={triggerUpdate} />
    );
}
