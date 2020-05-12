/* This file contains all of the types that are common to the extension and the infoview. */

import {  Message, Task } from 'lean-client-js-node';

// import { ServerStatus } from './server';

export interface ServerStatus {
    stopped: boolean;
    isRunning: boolean;
    numberOfTasks: number;
    tasks: Task[];
}

export interface WidgetEventMessage {
    command: 'widget_event';
    kind: 'onClick' | 'onMouseEnter' | 'onMouseLeave' | 'onChange';
    handler: number;
    route: number[];
    args: { type: 'unit' } | { type: 'string'; value: string };
    file_name: string;
    line: number;
    column: number;
}

export enum DisplayMode {
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage, // all messages
}

export interface InfoProps {
    widget?: string; // [note] vscode crashes if the widget is sent as a deeply nested json object.
    goalState?: string;
    messages?: Message[];

    fileName: string;
    line: number; column: number;
    location_name: string; // ${fileName}:${line}:${col}
    base_name: string;

    displayMode: DisplayMode;
    infoViewTacticStateFilters: any[];
    filterIndex;
}

/** The root state of the infoview */
export interface InfoViewState {
    cursorInfo: InfoProps;
    pinnedInfos: InfoProps[];
    // serverStatus: ServerStatus;
}

/** Message from the extension to the infoview */
export type InfoviewMessage = {
    command: 'sync';
    props: InfoViewState;
} | {
    command: 'continue';
} | {
    command: 'pause';
} | {
    command: 'position';
    fileName; line; column;
} | {
    command: 'set_pin' | 'unset_pin';
    fileName; line; column;
}