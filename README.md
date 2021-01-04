# Lean 4 VSCode Extension
This extension provides VSCode editor support for the Lean 4 programming language.
It is based upon the [lsp-sample](https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample) and includes code from [vscode-lean](https://github.com/leanprover/vscode-lean).

## Functionality
This extension is intended mostly for debugging purposes and to provide a tool to demonstrate Lean 4 with to users that are used to using Lean 3 together with VSCode. It is also supposed to provide an easily dissectible and minimal base for the Lean 3 community to work with and extend upon to port all the existing Lean 3 client features to Lean 4.

As of now, the extension supports the following features:
- Diagnostics
- Syntax highlighting with basic Lean 4 syntax rules
- `\foo` unicode shortcuts
- Command to refresh file dependencies using Ctrl+Shift+R after recompilation
- [Breadcrumbs](https://code.visualstudio.com/Docs/editor/editingevolved#_breadcrumbs)

## Running the client
Add `lean` to your `PATH` (e.g. using [`elan`](https://github.com/Kha/elan) and set your `LEAN_PATH` if you are working on a project other than Lean 4 itself as described [here](https://leanprover.github.io/lean4/doc/setup.html#basic-setup)). Then, install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=mhuisi.lean4). If you are using the [nix setup](https://leanprover.github.io/lean4/doc/setup.html#nix-setup), you can also run VSCode using the nix integration mentioned [here](https://leanprover.github.io/lean4/doc/setup.html#basic-commands).

You may first need to disable the Lean 3 VSCode extension if you have it installed.

## Building the client
Assuming `lean` is in your `PATH` (e.g. using [`elan`](https://github.com/Kha/elan)):
- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the client.
- Switch to the Debug viewlet (Ctrl+Shift+D).
- Select `Launch Client` from the drop down.
- Run the launch config.

## Code by vscode-lean
`src/input.ts`, `syntaxes`, `language-configuration.json`, `translations.json` and the code to load `src/input.ts` in `extension.ts` have been taken from [vscode-lean](https://github.com/leanprover/vscode-lean).
