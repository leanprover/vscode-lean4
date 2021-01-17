# Lean 4 VSCode Extension
This extension provides VSCode editor support for the Lean 4 programming language.
It is based upon [vscode-lean](https://github.com/leanprover/vscode-lean).

## Functionality
This extension is intended mostly for debugging purposes and to provide a tool to demonstrate Lean 4 with to users that are used to using Lean 3 together with VSCode. It is also supposed to provide an easily dissectible and minimal base for the Lean 3 community to work with and extend upon to port all the existing Lean 3 client features to Lean 4.

As of now, the extension supports the following features:
- Diagnostics
- Syntax highlighting with basic Lean 4 syntax rules
- `\foo` unicode shortcuts
- Command to refresh file dependencies using Ctrl+Shift+R after recompilation
- Type information & documentation on hover since [leanprover/lean4@d7c201a2](https://github.com/leanprover/lean4/commit/d7c201a2d4c4a0d0e76405e6d5325b63cb08ea11)
- [Breadcrumbs](https://code.visualstudio.com/Docs/editor/editingevolved#_breadcrumbs)

## Running the client
Add `lean` to your `PATH` (e.g. using [`elan`](https://github.com/Kha/elan)) and set your `LEAN_PATH` if you are working on a project other than Lean 4 itself as described [here](https://leanprover.github.io/lean4/doc/setup.html#basic-setup). Then, install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=mhuisi.lean4). If you are using the [nix setup](https://leanprover.github.io/lean4/doc/setup.html#nix-setup), you can also run VSCode using the nix integration mentioned [here](https://leanprover.github.io/lean4/doc/setup.html#basic-commands).

## Building the client
- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the client.
- Switch to the Debug viewlet (Ctrl+Shift+D).
- Select `Launch Client` from the drop down.
- Run the launch config.