export interface PlainGoal {
    rendered: string;
    // since 2021-03-10
    goals?: string[];
}

export interface ServerProgress {
    // Line number
    [uri: string]: number | undefined;
}