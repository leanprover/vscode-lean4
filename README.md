# Lean 4 VSCode Extension
This extension provides VSCode editor support for the Lean 4 programming language.
It is based upon [vscode-lean](https://github.com/leanprover/vscode-lean).

## Functionality
As of now, the extension supports the following features:
- Diagnostics
- Syntax highlighting with basic Lean 4 syntax rules
- `\foo` unicode shortcuts
- A simple info view since [leanprover/lean4@ec903f58](https://github.com/leanprover/lean4/commit/ec903f58d294cc7c57008a9cf754745fa7024f8c) (2021-02-04)
- Go to definition since [leanprover/lean4@e627ad30](https://github.com/leanprover/lean4/commit/e627ad308d0d19d0407c0c7cb3ec82fb93fc12ea) (2021-01-19)
- Type information & documentation on hover since [leanprover/lean4@d7c201a2](https://github.com/leanprover/lean4/commit/d7c201a2d4c4a0d0e76405e6d5325b63cb08ea11) (2021-01-15)
- [Breadcrumbs](https://code.visualstudio.com/Docs/editor/editingevolved#_breadcrumbs)
- Command to refresh file dependencies using Ctrl+Shift+X after recompilation
- Command to restart the full Lean 4 server, accessible via Ctrl+Shift+P
- Command to freeze/unfreeze the info view using Ctrl+Shift+T
- Compatibility with the [Lean 3 VSCode extension](https://github.com/leanprover/vscode-lean)

## Running the client
Install Lean 4 as described [in the documentation](https://leanprover.github.io/lean4/doc/setup.html).
Then, install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4). If you are using the [nix setup](https://leanprover.github.io/lean4/doc/setup.html#nix-setup), you can also run VSCode using the Nix integration mentioned [here](https://leanprover.github.io/lean4/doc/setup.html#basic-commands).

## Building the client
- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the client.
- Switch to the Debug viewlet (Ctrl+Shift+D).
- Select `Launch Client` from the drop down.
- Run the launch config.
