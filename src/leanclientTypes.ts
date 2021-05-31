export interface PlainGoal {
    rendered: string;
    // since 2021-03-10
    goals?: string[];
}

interface Position {
    line: number;
    character: number;
}

interface Range {
    start: Position;
    end: Position;
}

export interface PlainTermGoal {
    goal: string;
    range: Range;
}

export interface ServerProgress {
    // Line number
    [uri: string]: number | undefined;
}