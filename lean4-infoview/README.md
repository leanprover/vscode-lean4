# Lean 4 Infoview

The Lean 4 infoview is a React app providing an interactive display of messages, errors, proof states, and other outputs of Lean elaboration. Its capabilities can be extended using *user widgets* which may import `@leanprover/infoview` to access builtin functionality. This page contains technical information about how to embed the infoview in an editor plugin. For a friendly guide to user widgets, go [here](https://leanprover.github.io/lean4/doc/examples/widgets.lean.html) instead.

## Hosting

The infoview can be hosted within any LSP-compatible editor capable of displaying a webpage (e.g. a web-based editor, or via a WebKit panel, or in an external browser) and communicating with said webpage (e.g. via [`Window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)). The hosting editor must also be capable of sending duplicates of received and emitted LSP notifications to the infoview, as well as of relaying LSP requests between the infoview and the LSP server. There are specific requirements on how the infoview code is loaded — see below.

⚠️ WARNING: Note that we have not tested the infoview outside of VSCode, so it is likely that a port to any other environment will need to generalize VSCode-specific parts.

## Loading the infoview

Making user widgets dynamically loadable requires going through some contortions. The package exposes two entrypoints — `@leanprover/infoview` itself and `@leanprover/infoview/loader`. The former contains the React app. It is an ECMAScript module which *must* be loaded as a module into a runtime environment with:
- support for [dynamic `import`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import); and
- a properly set up [`importmap`](https://github.com/WICG/import-maps).

In particular, `@leanprover/infoview` should not be transpiled into something like UMD by a bundler. To make this a bit easier, we provide the [`@leanprover/infoview/loader`](./src/loader.ts) entrypoint which creates such an environment and loads the infoview into it. To use it, `import` it as usual (the loader *can* be bundled) and see documentation on the code.

(The alternative to using `/loader` is to embed the infoview in a webpage using `<script type="module" ..>` or to use a dynamic loader such as [SystemJS](https://github.com/systemjs/systemjs).)

## Editor support

- VSCode via [`vscode-lean4`](https://github.com/leanprover-community/vscode-lean4)
- Web playground via [`lean4web`](https://github.com/hhu-adam/lean4web)
