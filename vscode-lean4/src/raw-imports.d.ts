// Module declarations for raw-text imports of shell scripts. Webpack's
// `asset/source` rule (see `webpack.config.js`) inlines the file content
// as a string at bundle time; this shim teaches `tsc` the same shape so
// `import script from './foo.sh'` type-checks.
declare module '*.sh' {
    const content: string
    export default content
}
declare module '*.ps1' {
    const content: string
    export default content
}
