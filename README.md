# Lean 4 VSCode Extension
This extension provides VSCode editor support for the Lean 4 programming language.
It is based upon the [lsp-sample](https://github.com/microsoft/vscode-extension-samples/tree/master/lsp-sample) and includes code from [vscode-lean](https://github.com/leanprover/vscode-lean).

## Functionality
This extension is intended mostly for debugging purposes and to provide a tool to demonstrate Lean 4 with to users that are used to using Lean 3 together with VSCode. It is also supposed to provide an easily dissectible and minimal base for the Lean 3 community to work with and extend upon to port all the existing Lean 3 client features to Lean 4.

As of now, the extension supports the following features:
- Diagnostics
- Syntax highlighting with Lean 3 syntax rules
- `\foo` unicode shortcuts

## Running the client
- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Edit `command` and `LEAN_PATH` in `src/extension.ts` to point to your Lean 4 binary and library folder. Note that the path may look different if you are running a Nix installation of Lean.
- Press Ctrl+Shift+B to compile the client.
- Switch to the Debug viewlet.
- Select `Launch Client` from the drop down.
- Run the launch config.

## Code by vscode-lean
`src/input.ts`, `syntaxes`, `language-configuration.json`, `translations.json` and the code to load `src/input.ts` in `extension.ts` have been taken from [vscode-lean](https://github.com/leanprover/vscode-lean).