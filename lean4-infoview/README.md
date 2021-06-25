# Lean 4 Infoview

This package is a React app providing the interactive Lean 4 infoview. It can be hosted within any editor with a hookable LSP client. In particular, the client must be able to send duplicates of received and emitted LSP notifications to the infoview, as well as relay requests between the infoview and the LSP server.

## Hosting

A hosting editor needs to be able to display a minimal webpage (e.g. via a Webkit panel, or in an external browser). The webpage should set up a connection to the editor as defined in [`src/infoviewApi.ts`](src/infoviewApi.ts) and invoke the [`renderInfoview`](src/index.ts) entry point. The `lean4-infoview` library is distributed as an UMD module with external dependencies specified in [`webpack.config.js`](webpack.config.js) `externals` .

## Editor support

- VSCode via [`vscode-lean4`](https://github.com/leanprover-community/vscode-lean4)