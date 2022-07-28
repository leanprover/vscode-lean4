# Lean 4 Infoview

The Lean 4 infoview is a React app providing an interactive display of messages, errors, proof states, and other outputs of Lean elaboration. Its contents can be customized using extensions we call *widgets*. Widgets are written in Lean itself, and in TypeScript.

The package here — `@leanprover/infoview` — provides both the React app with its single `renderInfoview` entry point, as well as React components and other utilities for implementing widgets.

## Components

A TypeScript API for use in widgets is exported in [`components.ts`](src/components.ts).

⚠️ WARNING: The API is experimental and subject to breaking changes at any point.

## Hosting

The infoview can be hosted within any LSP-compatible editor capable of displaying web content (e.g. via a WebKit panel, or in an external browser) and communicating with its context (e.g. via something like [`Window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)). The hosting editor must also be able to send duplicates of received and emitted LSP notifications to the infoview, as well as relay requests between the infoview and the LSP server.

Hosting the infoview boils down to displaying the webview, and then executing a script there to set up editor<->infoview communication via [`InfoviewApi`/`EditorApi`](../lean4-infoview-api/src/infoviewApi.ts). The APIs detail a number of methods which the editor must implement, for example to provide the infoview with cursor positions. Finally the [`renderInfoview`](src/index.ts) entry point can be invoked.

The `lean4-infoview` library is distributed as an ECMAScript module. For widget extensions to work, it *must* be loaded as an ECMAScript module using either `<script type="module" ..>` or a loader such as System.js, with external dependencies specified in the [configuration](rollup.config.js) provided under their expected names (probably via an [`importmap`](https://github.com/WICG/import-maps)).

⚠️ WARNING: Note that we have not tested the infoview outside of VSCode, so it is likely that a port to any other environment will need to remove VSCode-specific leftovers.

### Editor support

- VSCode via [`vscode-lean4`](https://github.com/leanprover-community/vscode-lean4)
