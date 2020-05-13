/* This file contains all of the types that are common to the extension and the infoview. */

import {  Message, Task } from 'lean-client-js-node';

// import { ServerStatus } from './server';

// [todo] this is probably already defined somewhere
export interface Location {
    file_name: string;
    line: number;
    column: number;
}

export interface ServerStatus {
    stopped: boolean;
    isRunning: boolean;
    numberOfTasks: number;
    tasks: Task[];
}

interface WidgetEventResponseSuccess {
    status: 'success';
    widget: any;
}
interface WidgetEventResponseEdit {
    status: 'edit';
    widget: any;
    /** Some text to insert after the widget's comma. */
    action: string;
}
interface WidgetEventResponseInvalid {
    status: 'invalid_handler';
}
interface WidgetEventResponseError {
    status: 'error';
    message: string;
}
export type WidgetEventResponse = WidgetEventResponseSuccess | WidgetEventResponseInvalid | WidgetEventResponseEdit | WidgetEventResponseError


export interface WidgetEventMessage extends Location {
    command: 'widget_event';
    kind: 'onClick' | 'onMouseEnter' | 'onMouseLeave' | 'onChange';
    handler: number;
    route: number[];
    args: { type: 'unit' } | { type: 'string'; value: string };
}

export enum DisplayMode {
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage, // all messages
}

export interface InfoProps extends Location {
    widget?: string; // [note] vscode crashes if the widget is sent as a deeply nested json object.
    goalState?: string;

    location_name: string; // ${fileName}:${line}:${col}
    base_name: string;     // = basename(fileName)
}

export interface Config {
    filterIndex;
    infoViewTacticStateFilters: any[];
    infoViewAllErrorsOnLine: boolean;
    displayMode: DisplayMode;
}

/** The root state of the infoview */
export interface InfoViewState {
    cursorInfo: InfoProps;
    pinnedInfos: InfoProps[];
    // serverStatus: ServerStatus;

    config: Config;

    messages: Message[];
}

export interface InsertTextMessage {
    command: 'insert_text';
    loc: Location;
    text: string;
}
export interface RevealMessage {
    command: 'reveal';
    loc: Location;
}
export interface ServerRequestMessage {
    command: 'server_request';
    request;
}

export type FromInfoviewMessage = ServerRequestMessage | InsertTextMessage | RevealMessage

/** Message from the extension to the infoview */
export type ToInfoviewMessage = {
    command: 'server_response';
    response;
} | ({command: 'position'} & Location)
| {command: 'on_all_messages'; messages: Message[]}
| {command: 'on_server_status_changed'; status: ServerStatus}
| {
    command: 'on_config_change';
    config: Config;
}