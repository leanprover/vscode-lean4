import { Signal, SignalBuilder } from './util';
import { Event, CurrentTasksResponse, WidgetEventHandler, WidgetEventRequest, WidgetData, GoalState, Message } from 'lean-client-js-core'
import { global_server, ServerRestartEvent, ConfigEvent } from './server';
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


interface WidgetEventArgs {
    kind;
    handler: WidgetEventHandler;
    args;
}

export function infoEvents(sb: SignalBuilder, sinks: {onEdit}, onProps: Signal<InfoProps>): Signal<InfoState> {
    const onForceUpdate = sb.mkEvent<any>();
    const onWidgetEvent = sb.mkEvent<WidgetEventArgs>();
    const state = sb.mkEvent<InfoState>();
    const statev = sb.store(state);

    const {loc: onLoc, isPaused: onPaused} = sb.unzip(onProps, ['loc', 'isPaused']);
    sb.store(onLoc);
    sb.store(onPaused);

    const throttled_loc = sb.throttle<Location>(300, onLoc);
    const onTasks = sb.throttle(300, global_server.tasks);
    const onIsLoading = sb.map(({l, t}) => isLoading(t, l), sb.zip({l:throttled_loc, t:onTasks}));

    const updateTrigger = sb.merge(sb.filter((x) => !onPaused.value, sb.merge(
        ServerRestartEvent,
        global_server.error,
        sb.filter(x => !x, onPaused),
        sb.onChange(onIsLoading),
        sb.map(isDone, onTasks),
        throttled_loc
    )), onForceUpdate);

    const onMessage = sb.map(({msgs, loc, config}) => {
        return {messages: GetMessagesFor(msgs.msgs, loc, config)};
    }, sb.zip({msgs: global_server.allMessages, loc: throttled_loc, config: ConfigEvent}));

    const {result, isRunning} = sb.throttleTask<Location, Partial<InfoState>>(async () => {
        const loc = onLoc.value;
        if (!loc) {return {};}
        try {
                // [todo] if the location has not changed keep the widget and goal state?
                const res: any = {widget: null, goalState: null, error: null};
                const info = await global_dispatcher.run(() => global_server.info(loc.file_name, loc.line, loc.column));
                const record = info.record;
                res.goalState = record && record.state;
                if (record && record.widget) {
                    if (record.widget.html !== undefined) {
                        res.widget = record.widget;
                    } else {
                        const { widget: newWidget } = await global_server.send({
                            command: 'get_widget',
                            line: record.widget.line,
                            column: record.widget.column,
                            id: record.widget.id,
                            file_name: loc.file_name,
                        });
                        res.widget = newWidget;
                    }
                }
                return res;
            } catch (error) {
                return {error};
            }
    }, updateTrigger);

    const we = sb.mapTaskOrdered(async (e) => {
        const s = statev.value;
        if (!s) {return {}; }
        if (!s.loc) {return {};}
        if (!s.widget) {return {};}
        const message: WidgetEventRequest = {
            command: 'widget_event',
            line: s.widget.line,
            column: s.widget.column,
            id: s.widget.id,
            file_name: s.loc.file_name,
            ...e,
        };
        const update_result = await global_server.send(message);
        if (!update_result.record) { return; }
        const record = update_result.record;
        if (record.status === 'success' && record.widget) {
            return {widget: record.widget};
        } else if (record.status === 'edit') {
            sinks.onEdit(s.loc, record.action);
            return {widget: record.widget};
        } else if (record.status === 'invalid_handler') {
            console.warn(`No widget_event update for ${message.handler}: invalid handler.`)
        } else if (record.status === 'error') {
            console.error(`Update gave an error: ${record.message || record}`);
        }
    }, onWidgetEvent);

    const r: Signal<Partial<InfoState>> = sb.merge(
        result,
        sb.map<boolean, Partial<InfoState>>(l => ({isLoading:l}), sb.debounce(300, onIsLoading)),
        sb.map<boolean, Partial<InfoState>>(l => ({isUpdating:l}), sb.debounce(300, isRunning)),
        onProps,
        we,
        onMessage,
    );

    const defaultInfoProps: InfoState = {
        isLoading: false,
        isUpdating: false,
        isPaused: false,
        messages: [],
        forceUpdate: () => onForceUpdate.fire({}),
        handleWidgetEvent: (w) => onWidgetEvent.fire(w)
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
    widget?: WidgetData;
    goalState?: GoalState;
    error?: {message: string};
    messages: Message[];

    forceUpdate: () => void;
    handleWidgetEvent;
}

const defaultInfoState: InfoState = {
    isLoading: false,
    isUpdating: false,
    isPaused: false,
    messages: [],
    forceUpdate: () => {},
    handleWidgetEvent: () => {},
}

export function useInfo(ps: InfoProps, onEdit) {
    const [g,s] = React.useState(defaultInfoState);
    const pes = React.useRef<Event<InfoProps>>();
    React.useEffect(() => {
        const sb = new SignalBuilder();
        pes.current = sb.mkEvent<InfoProps>();
        sb.push(infoEvents(sb, {onEdit}, pes.current).on(s));
        return () => sb.dispose();
    }, []);
    React.useEffect(() => {
        pes.current.fire(ps);
    }, [ps.isPaused, ps.loc && locationKey(ps.loc)]);
    return g;
}