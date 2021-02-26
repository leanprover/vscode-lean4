# Lean 4 VSCode Extension
This extension provides VSCode editor support for the Lean 4 programming language.
It is based on [vscode-lean](https://github.com/leanprover/vscode-lean).

## Running the client
1. Install a Lean 4 nightly build as described [in the documentation](https://leanprover.github.io/lean4/doc/setup.html).
2. Install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4).
3. Create a Lean 4 project using [leanpkg](https://leanprover.github.io/lean4/doc/setup.html#leanpkg) and open the project folder with VSCode. If you have a global installation of Lean 4, e.g. using `elan default leanprover/lean4:nightly` as described in the documentation above, you can also just open single `.lean` files independent of a project folder.
4. Open a `.lean` file and type in `#eval 1`. The extension should display a blue underline below `#eval`. Upon hovering over it, a hover panel reporting the result of the evaluation should pop up. When hovering over the `1`, a hover panel displaying the type of `1` should pop up.

If no blue underline is displayed, make sure that Lean 4 is installed correctly by running `lean --version` in your project folder. The VSCode extension will not activate if it cannot find the `lean` command or `lean --version` reveals that Lean 3 is installed instead.

If the blue underline is displayed but the type is not displayed when hovering over `1`, make sure that you are using a nightly build of Lean 4, not the stable version.

### Using the Nix setup instead
1. Install Lean 4 using [the Nix setup](https://leanprover.github.io/lean4/doc/setup.html#nix-setup).
2. Create a Lean 4 Nix project and run the pinned version of VSCode as described [here](https://leanprover.github.io/lean4/doc/setup.html#basic-commands).

## Refreshing file dependencies
As of now, after changing and rebuilding the dependency of a Lean 4 file, the language server needs to be manually informed that it should re-elaborate the full file, including the imports. This can be done using the `Lean 4: Refresh File Dependencies` command, which can be activated via Ctrl+Shift+X by default.

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

## Building the client
- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the client.
- Switch to the Debug viewlet (Ctrl+Shift+D).
- Select `Launch Client` from the drop down.
- Run the launch config.
