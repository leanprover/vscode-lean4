/* This file contains all of the types that are common to the extension and the infoview. */

import {  Message, Task } from 'lean-client-js-node';

// import { ServerStatus } from './server';

// [todo] this is probably already defined somewhere
export interface Location {
    file_name: string;
    line: number;
    column: number;
}

export function locationKey(l: Location): string {
    return `${l.file_name}:${l.line}:${l.column}`;
}
export function locationEq(l1: Location, l2: Location) {
    return l1.column === l2.column && l1.line === l2.line && l1.file_name === l2.file_name
}

export interface ServerStatus {
    stopped: boolean;
    isRunning: boolean;
    numberOfTasks: number;
    tasks: Task[];
}

interface WidgetEventResponseSuccess {
    status: 'success';
    widget: {html: any};
}
interface WidgetEventResponseEdit {
    status: 'edit';
    widget: {html: any};
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

export interface WidgetEventHandler {
    /** handler id */
    h: number;
    /** route */
    r: number[];
}

export interface WidgetElement {
    /** tag */
    t: 'div' | 'span' | 'hr' | 'button' | 'input'; // ... etc ... any string
    /** children */
    c: WidgetHtml[];
    /** attributes */
    a: { [k: string]: any };
    /** events */
    e: {
        'onClick'?: WidgetEventHandler;
        'onMouseEnter'?: WidgetEventHandler;
        'onMouseLeave'?: WidgetEventHandler;
    };
    /** tooltip */
    tt?: WidgetHtml;
}
export interface WidgetComponent {
    /** children */
    c: WidgetHtml[];
}
export function isWidgetElement(h: WidgetHtml): h is WidgetElement { return typeof h === 'object' && (h as any).t !== undefined}
// function isComponent(h: html): h is component { return typeof h === 'object' && (h as any).t === undefined }
export type WidgetHtml =
    | WidgetComponent
    | string
    | WidgetElement
    | null


export interface WidgetEventMessage extends Location {
    command: 'widget_event';
    kind: 'onClick' | 'onMouseEnter' | 'onMouseLeave' | 'onChange';
    handler: WidgetEventHandler;
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
export const defaultConfig = {
    filterIndex: -1,
    infoViewTacticStateFilters: [],
    infoViewAllErrorsOnLine: true,
    displayMode: DisplayMode.AllMessage,
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
    /** If no location is given set to be the cursor position. */
    loc?: Location;
    text: string;
}
export interface RevealMessage {
    command: 'reveal';
    loc: Location;
}
export interface ServerRequestMessage {
    command: 'server_request';
    payload: string;
}
export interface HoverPositionMessage {
    command: 'hover_position';
    loc: Location;
    // uri: string; line: number; column: number; endLine: number; endColumn: number;
}

export interface SyncPinMessage {
    command: 'sync_pin';
    pins: Location[];
}

export type FromInfoviewMessage =
    | ServerRequestMessage
    | InsertTextMessage
    | RevealMessage
    // | {command: 'copy_to_comment_response'; text: string}
    | HoverPositionMessage
    | {command: 'stop_hover'}
    | SyncPinMessage

/** Message from the extension to the infoview */
export type ToInfoviewMessage =
    | { command: 'server_event' | 'server_error'; payload: string} // payloads have to be stringified json because vscode crashes if the depth is too big. }
    | { command: 'position'; loc: Location}
    | { command: 'on_config_change'; config: Config}
    | SyncPinMessage
    // | { command: 'copy_to_comment_request'; loc: Location }