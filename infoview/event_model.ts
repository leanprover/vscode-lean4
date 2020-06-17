import { Signal, SignalBuilder } from './util';
import { Event, CurrentTasksResponse, GoalState, Message, WidgetIdentifier } from 'lean-client-js-core'
import { global_server, ServerRestartEvent, ConfigEvent, AllMessages } from './server';
import {Location, locationKey,} from '../src/shared';
import { GetMessagesFor } from './messages';
import * as React from 'react';

function isLoading(ts: CurrentTasksResponse, l: Location) {
    if (l === undefined) {return false; }
    return ts.tasks.some(t => t.file_name === l.file_name && t.pos_line < l.line && l.line < t.end_pos_line);
}
function isDone(ts: CurrentTasksResponse) {
    return ts.tasks.length === 0
}

/** Older versions of Lean can't deal with multiple simul info requests so this just prevents that. */
class OneAtATimeDispatcher {
    inflight = 0;
    head: Promise<any> = new Promise((r) => r({}));
    constructor () {}
    run<T>(tb: () => Promise<T>): Promise<T> {
        if (this.inflight === 0) {
            this.inflight++;
            this.head = tb().finally(() => {this.inflight--;});
            return this.head;
        } else {
            this.inflight++;
            this.head = this.head
                .catch(() => ({}))
                .then(() => tb().finally(() => {this.inflight--;}));
            return this.head;
        }
    }
}
const global_dispatcher = new OneAtATimeDispatcher();

export function infoEvents(sb: SignalBuilder, onProps: Signal<InfoProps>): Signal<InfoState> {
    const onForceUpdate = sb.mkEvent<any>();
    const state = sb.mkEvent<InfoState>();
    const statev = sb.store(state);

    const {loc: onLoc, isPaused: onPaused} = sb.unzip(onProps, ['loc', 'isPaused']);
    sb.store(onLoc);
    sb.store(onPaused);

    const throttled_loc = sb.throttle<Location>(300, onLoc);
    const onLocChange = sb.onChange(throttled_loc, (x,y) => !x || !y || locationKey(x) !== locationKey(y));
    const onTasks = sb.throttle(300, global_server.tasks);
    const onIsDone = sb.filter(isDone, onTasks);
    const onIsLoading = sb.map(({l, t}) => isLoading(t, l), sb.zip({l:throttled_loc, t:onTasks}));

    const updateTrigger = sb.merge(sb.filter((x) => !onPaused.value, sb.merge(
        ServerRestartEvent,
        global_server.error,
        sb.filter(x => !x, onPaused),
        sb.onChange(onIsLoading),
        onLocChange,
    )), onForceUpdate);

    const onMessage = sb.map(({msgs, loc, config}) => {
        return {messages: GetMessagesFor(msgs, loc, config)};
    }, sb.zip({msgs: AllMessages, loc: throttled_loc, config: ConfigEvent}));

    const {result, isRunning} = sb.throttleTask<any, Partial<InfoState>>(async () => {
        const loc = onLoc.value;
        let maxTries = 2;
        if (!loc) {return {widget: null, goalState: null, error: null};}
        try {
            while (true) {
                // [todo] if the location has not changed keep the widget and goal state?
                const info = await global_dispatcher.run(() => global_server.info(loc.file_name, loc.line, loc.column));
                const record = info.record;
                const goalState = record && record.state;
                const widget = record && record.widget;
                if (widget && widget.line === undefined) {
                    widget.line = loc.line;
                    widget.column = loc.column;
                }
                if (!widget && !goalState && maxTries > 0) {
                    await new Promise((res) => setTimeout(res, 100));
                    maxTries--;
                } else {
                    return { widget, goalState, error: null };
                }
            }
        } catch (error) {
            return {error};
        }
    }, updateTrigger);

    const r: Signal<Partial<InfoState>> = sb.merge(
        result,
        sb.map<boolean, Partial<InfoState>>(l => ({isLoading:l}), sb.debounce(300, onIsLoading)),
        sb.map<boolean, Partial<InfoState>>(l => ({isUpdating:l}), sb.debounce(300, isRunning)),
        onProps,
        onMessage,
    );

    const defaultInfoProps: InfoState = {
        isLoading: false,
        isUpdating: false,
        isPaused: false,
        messages: [],
        forceUpdate: () => onForceUpdate.fire({}),
    };
    const z = sb.scan<InfoState,Partial<InfoState>>((acc, x) => ({...acc, ...x}), defaultInfoProps, r);
    sb.push(z.on(x => state.fire(x)));
    return state;
}

export interface InfoProps {
    isPinned: boolean;
    isCursor: boolean;
    isPaused: boolean;
    loc: Location;
}

export interface InfoSinks {
    onEdit: (l: Location, text: string) => void;
    onPin: (new_pin_state: boolean) => void;
    setPaused: (paused: boolean) => void;
}

export interface InfoState {
    loc?: Location;
    isPaused: boolean;

    isLoading: boolean;
    isUpdating: boolean;
    widget?: WidgetIdentifier;
    goalState?: GoalState;
    error?: {message: string};
    messages: Message[];

    forceUpdate: () => void;
}

const defaultInfoState: InfoState = {
    isLoading: false,
    isUpdating: false,
    isPaused: false,
    messages: [],
    forceUpdate: () => {},
}

export function useInfo(ps: InfoProps) {
    const [g,s] = React.useState(defaultInfoState);
    const pes = React.useRef<Event<InfoProps>>();
    React.useEffect(() => {
        const sb = new SignalBuilder();
        pes.current = sb.mkEvent<InfoProps>();
        sb.push(infoEvents(sb, pes.current).on(s));
        return () => sb.dispose();
    }, []);
    React.useEffect(() => {
        pes.current.fire(ps);
    }, [ps.isPaused, ps.loc && locationKey(ps.loc)]);
    return g;
}