/* This file contains all of the types that are common to the extension and the infoview. */

import { Message } from 'lean-client-js-node';
export interface WidgetEventMessage {
    command : "widget_event",
    kind : "onClick" | "onMouseEnter" | "onMouseLeave" | "onChange";
    handler : number,
    route : number[],
    args : {type : "unit"} | {type : "string", value : string};
    file_name : string,
    line : number,
    column : number
}

export enum DisplayMode {
    OnlyState, // only the state at the current cursor position including the tactic state
    AllMessage, // all messages
}

export interface InfoProps {
    widget? : string,
    goalState?: string,
    messages?: Message[],

    fileName: string,

    displayMode: DisplayMode,
    infoViewTacticStateFilters: any[],
    filterIndex
}

export type InfoviewMessage = {
    command : "sync",
    props : InfoProps
} | {
    command : "continue"
} | {
    command : "pause"
} | {
    command : "position",
    fileName, line, column
}