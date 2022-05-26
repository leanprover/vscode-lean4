# Changelog

### 0.0.41

- Read "lean-toolchain" files and do not set --default-toolchain to something specific.
- elan should not install multiple toolchains.

### 0.0.40 (Oct 21, 2021): c387eab150b988a47956192b0fc48e950f6c1fca

- Improved error handling when Lean language server fails to start.
- Fix InfoView stops updating afer "Lean 4: Resstart Server" command.
- Update project to npm version 8.1.0.

### 0.0.39 (Oct 20, 2021): 6510b32473fe589f0a1c36d7fc12d77a6956ea05

- Fix LeanDiagnostic type.

### 0.0.38 (Oct 20, 2021): ec38311418c92a95dfd8895bc28470140617a3c0

- Enable auto-install via elan.
- Report output from `lean --version` because that may result in a long running "downloading lean" session so this output helps explain to the user why the big delay and what if anything went wrong.
- Read Lean version from the leanpkg.toml file.
- addDefaultElanPath so PATH environment is not needed.
- Add support for pre-term goal Lean versions.
- Add info-on-hover widgets.
- Fix debugging of infoview source code.

### 0.0.36 (Oct 5, 2021): b88795134ba938d285bd896c33225f366fa46eed

- Remove begin / end from the brackets section of the language config.
- Add logging to abreviation rewriter so we can catch any future flakiness...
- Infoview should not be so aggressive about reopening all the time, and should not open on markdown files.
- Fix data loss in RPC.
- Show language server errors in popup
- Infoview now stays closed if user closes it

### 0.0.35 (Sep 29, 2021): 0ecaef8f7801928c217ceaabf22735bb57747aef

- add 'Lean 4: Select Interpreter' so user can enter a path that is workspace specific.
- auto open of Infoview should only happen once per vscode session.
- auto open of Infoview should not happen on markdown files.

### 0.0.33 (Jul 17, 2021): d5f1926be34e73af23d551be779a5b98e721e0ba

- New Infoview package
- Fix bug in collapsing state
- Add copyToComment command

### 0.0.31 (Jun 7, 2021): 0d834ab33bc8fb8a7627912519edf2f9ab9fc083

- map \. to cdot

### 0.0.30 (Jun 4, 2021): 40a07756b9c35bd974566dc65961b57ce5e0e7fd

- Fix duplicate timer events

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
