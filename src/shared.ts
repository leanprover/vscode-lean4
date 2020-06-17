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
}
export const defaultConfig: Config = {
    filterIndex: -1,
    infoViewTacticStateFilters: [],
    infoViewAllErrorsOnLine: true,
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

/** Message from the infoview to the extension. */
export type FromInfoviewMessage =
    | ServerRequestMessage
    | InsertTextMessage
    | RevealMessage
    | HoverPositionMessage
    | {command: 'stop_hover'}
    | SyncPinMessage

/** Message from the extension to the infoview. */
export type ToInfoviewMessage =
    | { command: 'server_event' | 'server_error'; payload: string} // payloads have to be stringified json because vscode crashes if the depth is too big. }
    | { command: 'position'; loc: Location}
    | { command: 'on_config_change'; config: Partial<Config>}
    | { command: 'all_messages'; messages: Message[]}
    | SyncPinMessage
    | { command: 'pause' | 'continue' | 'toggle_updating' | 'copy_to_comment' | 'toggle_pin' | 'restart'}