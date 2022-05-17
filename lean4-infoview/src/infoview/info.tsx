import * as React from 'react';
import type { Location } from 'vscode-languageserver-protocol';

import { Goals as GoalsUi, Goal as GoalUi, goalsToString } from './goals';
import { basename, DocumentPosition, RangeHelpers, useEvent, usePausableState } from './util';
import { Details } from './collapsing';
import { EditorContext, ProgressContext, RpcContext, VersionContext } from './contexts';
import { MessagesList, useMessagesFor } from './messages';
import { getInteractiveGoals, getInteractiveTermGoal, InteractiveDiagnostic, InteractiveGoal, InteractiveGoals } from './rpcInterface';
import { updatePlainGoals, updateTermGoal } from './goalCompat';

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
        'loading': 'gold',
        'updating': 'gold',
        'error': 'dark-red',
        'ready': '',
    }
    const statusColor = statusColTable[status];
    const locationString = `${basename(pos.uri)}:${pos.line+1}:${pos.character}`;
    const isPinned = kind === 'pin';

    return (
    <summary style={{transition: 'color 0.5s ease'}} className={'mv2 pointer' + statusColor}>
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
                   onClick={e => { e.preventDefault(); void ec.revealPosition(pos); }}
                   title="reveal file location" />}
            <a className={'link pointer mh2 dim codicon ' + (isPinned ? 'codicon-pinned' : 'codicon-pin')}
                onClick={e => { e.preventDefault(); onPin(pos); }}
                title={isPinned ? 'unpin' : 'pin'} />
            <a className={'link pointer mh2 dim codicon ' + (isPaused ? 'codicon-debug-continue' : 'codicon-debug-pause')}
               onClick={e => { e.preventDefault(); setPaused(!isPaused); }}
               title={isPaused ? 'continue updating' : 'pause updating'} />
            <a className="link pointer mh2 dim codicon codicon-refresh"
               onClick={e => { e.preventDefault(); void triggerUpdate(); }}
               title="update"/>
        </span>
    </summary>
    );
}

interface InfoDisplayProps extends InfoPinnable {
    pos: DocumentPosition;
    status: InfoStatus;
    messages: InteractiveDiagnostic[];
    goals?: InteractiveGoals;
    termGoal?: InteractiveGoal;
    error?: string;
    triggerUpdate: () => Promise<void>;
}

/** Displays goal state and messages. Can be paused. */
export function InfoDisplay(props0: InfoDisplayProps) {
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
    const [reverseOrder, setReverseOrder] = React.useState<boolean>(false);

    const {kind, pos, status, messages, goals, termGoal, error} = props;

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

    const nothingToShow = !error && !goals && !termGoal && messages.length === 0;

    const hasError = status === 'error' && error;
    const hasGoals = status !== 'error' && goals;
    const hasTermGoal = status !== 'error' && termGoal;
    const hasMessages = status !== 'error' && messages.length !== 0;
    const filterClasses = 'link pointer mh2 dim codicon fr ' + (reverseOrder ? 'codicon-arrow-up' : 'codicon-arrow-down');
    const sortButton = <a className={filterClasses} onClick={e => { setReverseOrder(!reverseOrder); }} title="reverse list"/>
    return (
    <Details initiallyOpen>
        <InfoStatusBar {...props} triggerUpdate={triggerDisplayUpdate} isPaused={isPaused} setPaused={setPaused} copyGoalToComment={copyGoalToComment} />
        <div className="ml1">
            {hasError &&
                <div className="error">
                    Error updating: {error}.
                    <a className="link pointer dim" onClick={e => { e.preventDefault(); void triggerDisplayUpdate(); }}>Try again.</a>
                </div>}
            <div style={{display: hasGoals ? 'block' : 'none'}}>
                <Details initiallyOpen>
                    <summary className="mv2 pointer">
                        Tactic state {sortButton}
                    </summary>
                    <div className='ml1'>
                        {hasGoals && <GoalsUi pos={pos} goals={goals} reverseOrder={reverseOrder} />}
                    </div>
                </Details>
            </div>
            <div style={{display: hasTermGoal ? 'block' : 'none'}}>
                <Details initiallyOpen>
                    <summary className="mv2 pointer">
                        Expected type {sortButton}
                    </summary>
                    <div className='ml1'>
                        {hasTermGoal && <GoalUi pos={pos} goal={termGoal} reverse={reverseOrder} />}
                    </div>
                </Details>
            </div>
            <div style={{display: hasMessages ? 'block' : 'none'}}>
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
                    <span>Updating is paused.
                        <a className="link pointer dim" onClick={e => { e.preventDefault(); void triggerDisplayUpdate(); }}>Refresh</a>
                        or <a className="link pointer dim" onClick={e => { e.preventDefault(); setPaused(false); }}>resume updating</a>
                        to see information.
                    </span> :
                    'No info found.')}
        </div>
    </Details>
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
    return async () => {
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
    };
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
    const rs = React.useContext(RpcContext);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const pos = props.pos!;

    const [status, setStatus] = React.useState<InfoStatus>('loading');
    const [goals, setGoals] = React.useState<InteractiveGoals>();
    const [termGoal, setTermGoal] = React.useState<InteractiveGoal>();
    const [error, setError] = React.useState<string>();

    const messages = useMessagesFor(pos);
    const serverIsProcessing = useIsProcessingAt(pos);

    const triggerUpdate = useDelayedThrottled(serverIsProcessing ? 500 : 50, async () => {
        setStatus('updating');

        let allReq
        if (sv?.hasWidgetsV1()) {
            // Start both goal requests before awaiting them.
            const goalsReq = getInteractiveGoals(rs, pos);
            const termGoalReq = getInteractiveTermGoal(rs, pos);
            allReq = Promise.all([goalsReq, termGoalReq]);
        } else {
            const goalsReq = ec.requestPlainGoal(pos).then(gs => {
                if (gs) return updatePlainGoals(gs)
                else return undefined
            })
            const termGoalReq = ec.requestPlainTermGoal(pos).then(g => {
                if (g) return updateTermGoal(g)
                else return undefined
            }).catch(() => undefined) // ignore error on Lean version that don't support term goals yet
            allReq = Promise.all([goalsReq, termGoalReq]);
        }

        function onError(err: any) {
            const errS = typeof err === 'string' ? err : JSON.stringify(err);
            setError(`Error fetching goals: ${errS}`);
            setStatus('error');
        }

        try {
            // NB: it is important to await both reqs at once, otherwise
            // if both throw then one exception becomes unhandled.
            const [goals, termGoal] = await allReq;
            setGoals(goals);
            setTermGoal(termGoal);
        } catch (err: any) {
            if (err?.code === -32801) {
                // Document has been changed since we made the request, try again
                void triggerUpdate();
                return;
            } else { onError(err); }
        }

        setStatus('ready');
    });

    React.useEffect(() => void triggerUpdate(), [pos.uri, pos.line, pos.character, serverIsProcessing]);

    return (
        <InfoDisplay {...props} pos={pos} status={status} messages={messages} goals={goals} termGoal={termGoal} error={error} triggerUpdate={triggerUpdate} />
    );
}
