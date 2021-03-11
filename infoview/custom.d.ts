// to get importing svg files to not error.
declare module '*.png' {
    const content: any;
    export default content;
}
declare module '*.svg' {
    const attributes: any;
    const content: string;
}