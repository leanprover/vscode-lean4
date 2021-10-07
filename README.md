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
- Semantic highlighting since [leanprover/lean4@5df753f3](https://github.com/leanprover/lean4/commit/5df753f3381dca714d0e81727d38feba765d6234) (2021-03-17)
- An infoview since [leanprover/lean4@ec903f58](https://github.com/leanprover/lean4/commit/ec903f58d294cc7c57008a9cf754745fa7024f8c) (2021-02-04)
- Go to definition since [leanprover/lean4@e627ad30](https://github.com/leanprover/lean4/commit/e627ad308d0d19d0407c0c7cb3ec82fb93fc12ea) (2021-01-19)
- Type information & documentation on hover since [leanprover/lean4@d7c201a2](https://github.com/leanprover/lean4/commit/d7c201a2d4c4a0d0e76405e6d5325b63cb08ea11) (2021-01-15)
- [Breadcrumbs](https://code.visualstudio.com/Docs/editor/editingevolved#_breadcrumbs)
- Command to refresh file dependencies using Ctrl+Shift+X after recompilation
- Command to restart the full Lean 4 server, accessible via Ctrl+Shift+P
- Compatibility with the [Lean 3 VSCode extension](https://github.com/leanprover/vscode-lean)

## For developers
The repository contains NPM packages implementing editor integration for the Lean 4 programming language. The VSCode extension proper is in [`vscode-lean4`](vscode-lean4/), while [`lean4-infoview`](lean4-infoview/) implements the information display. We build the packages in tandem using Lerna.

### Building
- Run `npm install` in this folder. This installs the Lerna package manager.
- Run `npx lerna bootstrap`. This sets up the project's dependencies.
- Run `npx lerna run build`. This compiles the extension (which is necessary for go-to-definition in vscode).

### Debugging
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the extension. This step is needed for a working development setup.
- Press F5 to launch the extension in the vscode debugger, (we've checked in the correct launch.json configuration.)

**Note:** if breakpoints are not working, try changing one line of code in `function activate` in `extension.ts`, even
adding a newline seems to work, then press F5.

## Changelog
### 0.0.29 (Jun 4, 2021)
- Adds support for term mode goals. Discussion at [leanprover/lean4#504](https://github.com/leanprover/lean4/issues/504).

### 0.0.26 - 0.0.28 (May 26, 2021)
- Adds an option `lean4.elaborationDelay` to configure the delay after which the Lean 4 server starts elaborating with all accumulated changes.

### 0.0.10 - 0.0.25 (Apr 28, 2021)
- Adds the options `lean4.serverEnvPaths` and `lean4.serverEnv` for adding environment variables and PATH components to the Lean 4 server environment.

### 0.0.7 - 0.0.9 (Mar 11, 2021)
- Ports the current [vscode-lean](https://github.com/leanprover/vscode-lean) infoview to vscode-lean4. Removes the `lean4.plainInfoView.toggleAutoUpdate` command and adds the following configuration options and commands:
  - Configuration options:
    - `lean4.infoViewAllErrorsOnLine`
    - `lean4.infoViewAutoOpen`
    - `lean4.infoViewAutoOpenShowGoal`
    - `lean4.infoViewStyle`
    - `lean4.infoViewTacticStateFilters`
    - `lean4.infoViewFilterIndex`
  - Commands:
    - `lean4.displayGoal` (Ctrl+Shift+Enter)
    - `lean4.displayList` (Ctrl+Shift+Alt+Enter)
    - `lean4.infoView.copyToComment`
    - `lean4.infoView.toggleStickyPosition`
    - `lean4.infoView.toggleUpdating`

### 0.0.3 - 0.0.6 (Feb 12, 2021)
- Implements a very basic infoview to display plaintext Lean 4 goals with basic highlighting. Includes a command `lean4.plainInfoView.toggleAutoUpdate` (Ctrl+Shift+T).

### 0.0.2 (Jan 26, 2021)
- Ports the rewrite of the abbreviation feature from [vscode-lean](https://github.com/leanprover/vscode-lean) to vscode-lean4. A discussion can be found at [leanprover/vscode-lean#240](https://github.com/leanprover/vscode-lean/pull/240).

### 0.0.1 (Jan 19, 2021)
- Ports previous barebones version of vscode-lean4 to start its history on top of [vscode-lean](https://github.com/leanprover/vscode-lean) for easier porting of PRs of vscode-lean to vscode-lean4. Includes the following features:
  - An LSP client
  - Support for Unicode abbreviations as taken from vscode-lean
  - A Lean 4 syntax declaration
  - A compatibility layer to enable users to install both vscode-lean and vscode-lean4 despite the file suffix conflict (see discussion in [leanprover/vscode-lean#253](https://github.com/leanprover/vscode-lean/pull/253))
  - The following configuration options:
    - `lean4.executablePath`
    - `lean4.input.enabled`
    - `lean4.input.customTranslations`
    - `lean4.input.languages`
    - `lean4.input.leader`
    - `lean4.serverLogging.enabled`
    - `lean4.serverLogging.path`
  - The following commands:
    - `lean4.restartServer`
    - `lean4.input.convert` (Tab)
    - `lean4.refreshFileDependencies` (Ctrl+Shift+X)
