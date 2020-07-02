# Lean for VS Code

This extension adds support for [Lean](https://github.com/leanprover/lean).

## Features

We currently support a variety of features.

* Automatic installation of Lean via [elan](https://github.com/Kha/elan)
* Incremental compilation and checking via the Lean server
* Hover shows documentation, types, and Unicode input help
* Auto-completion based on context and type via the Lean server
* Error messages / diagnostics
* Customizable Unicode input support (e.g. type `\la`+<kbd>tab</kbd> to input `λ`)
* Info view window to show goal, tactic state, and error messages:
  - click <img src="media/display-goal-light.png"> or hit <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd> for local goal view, or
  - click <img src="media/display-list-light.png"> or hit <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>alt</kbd>+<kbd>enter</kbd> for all messages
* Batch file execution
* Search for declarations in open files (<kbd>ctrl</kbd>+<kbd>p</kbd> `#`)
* Region of interest checking (i.e. control how much of the project is checked automatically by Lean)
* Fill in `{! !}` holes with the [code actions](https://code.visualstudio.com/docs/editor/refactoring#_code-actions-quick-fixes-and-refactorings) menu (<kbd>ctrl</kbd>+<kbd>.</kbd>)
* Tasks for `leanpkg` (<kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>p</kbd> and select "Tasks: Configure Task")
* Tactic state filtering with regex
* Type of the term under the cursor can be displayed in the status bar
* Tactic suggestions (tactics which suggest edits with a "Try this:" message) can be applied either with a keyboard shortcut (<kbd>alt</kbd>+<kbd>v</kbd>), by clicking on the info view message, or via code actions (<kbd>ctrl</kbd>+<kbd>.</kbd>)

## Requirements

This extension requires an installation of [Lean](https://leanprover.github.io). As of version 0.12.1, the extension can install Lean for you using [elan](https://github.com/Kha/elan). See the [mathlib installation docs](https://leanprover-community.github.io/get_started.html) for alternative instructions.

On Windows, if you installed Lean using MSYS2, you need to add both `C:\msys64\mingw64\bin` (or wherever you installed MSYS2) and `C:\projects\lean\bin` (or wherever you installed Lean) to the system `PATH` environment variable. To do this, press <kbd>Win</kbd>+<kbd>Pause</kbd> > go to Advanced System Settings > go to Environment variables. Under system variables (not user variables) find the `Path` variable, and add these two folders.

## Extension Settings

This extension contributes the following settings (for a complete list, open the VS Code Settings and scroll to "Lean configuration"):

* `lean.executablePath`: controls which Lean executable is used when starting the server. If you are bundling Lean and `vscode-lean` with [Portable mode VS Code](https://code.visualstudio.com/docs/editor/portable), you might find it useful to specify a relative path to Lean. This can be done by starting this setting string with `%extensionPath%`; the extension will replace this with the absolute path of the extension folder. For example, with the default directory setup in Portable mode, `%extensionPath%/../../../lean` will point to `lean` in the same folder as the VS Code executable / application.
* `lean.leanpkgPath`: controls which leanpkg executable is used for `leanpkg` task integration. The `%extensionPath%` token can be used here as well.
* `lean.timeLimit`: controls the `-T` flag passed to the Lean executable
* `lean.memoryLimit`: controls the `-M` flag passed to the Lean executable
* `lean.roiModeDefault`: controls the default region of interest, the options are:
  - `nothing`: check nothing
  - `visible`: check only visible files
  - `open`: check all open files
  - `project`: check the entire project's files
* `lean.input.leader`: character to type to trigger Unicode input mode (`\` by default)
* `lean.input.languages`: allows the Unicode input functionality to be used in other languages
* `lean.input.customTranslations`: add additional input Unicode translations. Example: `{"foo": "☺"}` will correct `\foo` to `☺` (assuming the `lean.input.leader` has its default value `\`).
* `lean.infoViewAutoOpen`: controls whether the info view is automatically displayed when the Lean extension is activated (`true` by default).
* `lean.infoViewTacticStateFilters`: An array of objects containing regular expression strings that can be used to filter (positively or negatively) the tactic state in the info view. Set to an empty array `[]` to hide the filter select dropdown. Each object must contain the following keys:
  - `regex` is a properly-escaped regex string,
  - `match` is a boolean, where `true` (`false`) means blocks in the tactic state matching `regex` will be included (excluded) in the info view,
  - `flags` are additional flags passed to the [JavaScript RegExp constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp).
  - The `name` key is optional and may contain a string that is displayed in the dropdown instead of the full regex details.
* `lean.infoViewFilterIndex`: index of the filter applied to the tactic state (in the array `lean.infoViewTacticStateFilters`). An index of -1 means no filter is applied.
* `lean.typeInStatusBar`: controls whether the type of the term under the cursor is displayed as a status bar item (`true` by default).
* `lean.typesInCompletionList`: controls whether the types of all items in the list of completions are displayed. By default, only the type of the highlighted item is shown.

It also contributes the following commands, which can be bound to keys if desired:

* `lean.input.convert`: converts the current Unicode abbreviation (bound to <kbd>tab</kbd> by default)
* `lean.infoView.displayGoal`: show the tactic state and any messages (e.g. info, warning, error) at the current position in the info view window (bound to <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd> by default)
* `lean.infoView.displayList`: show all messages for the current file from Lean in the info view window (bound to <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>alt</kbd>+<kbd>enter</kbd> by default)
* `lean.infoView.copyToComment`: copy the current contents of the info view into a new comment on the next line
* `lean.infoView.toggleUpdating`: pause / continue live updates of the info view (same as clicking on the <img src="media/pause.png"> and <img src="media/continue.png"> icons)
* `lean.roiMode.select`: select the region of interest (files to be checked by the Lean server)
* `lean.batchExecute`: execute the current file using Lean (bound to <kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>r</kbd> by default)
* `lean.pasteTacticSuggestion`: if any tactic suggestions (i.e. tactics which return a "Try this:" in their output) are active for the code under the cursor, apply the first suggested edit. (bound to <kbd>alt</kbd>+<kbd>v</kbd> by defaullt)

### Other potentially helpful settings

* Fonts with good Unicode support: `"editor.fontFamily": "Source Code Pro Medium, DejaVu Sans Mono"`. Note that for this configuration to work properly, both fonts must be specified in this order (so that characters that are not available in [Source Code Pro](https://github.com/adobe-fonts/source-code-pro) are rendered using [DejaVu Sans Mono](https://dejavu-fonts.github.io/)).
* By default, VS Code will complete `then` to `has_bind.and_then` when you press enter.  To disable this behavior, set `"editor.acceptSuggestionOnEnter": false`
* If you like colored brackets, try out [Bracket Pair Colorizer 2](https://marketplace.visualstudio.com/items?itemName=CoenraadS.bracket-pair-colorizer-2).

## Development

* Install `npm` (and for Ubuntu 17.04 `nodejs-legacy`)
* Install `code` from http://code.visualstudio.com
* Run `git clone https://github.com/leanprover/vscode-lean`
* Run `npm install` in the `vscode-lean` directory
* Install the [TSLint extension for vscode](https://marketplace.visualstudio.com/items?itemName=eg2.tslint)
* Open the `vscode-lean` directory in VS Code and start developing (<kbd>F5</kbd> starts the debugger)

## Release Notes

### 0.15.0
* Command to apply tactic suggestions such as from `library_search` (using <kbd>alt</kbd>+<kbd>v</kbd> or clicking "Try this:" in the info view)

### 0.14.0
* Show type of term under cursor in status bar

### 0.13.3
* Info view opens automatically

### 0.13.1
* Dropdown to filter tactic states

### 0.13.0
* Dropped support for Lean versions older than 3.1.0.

### 0.12.1
* Automated `elan` installation

### 0.11.2
* Tactic state highlighting

### 0.11
* Support for `visibleRanges` API in vscode.  Per default, only the currently visible lines and the rest of the file above are checked.

### 0.10.1
* Updated syntax highlighting.

### 0.10.0
* New configuration option for extra command-line arguments. (`lean.extraOptions`)
* Integration with `leanpkg`.

### 0.9.0
* Extremely improved info view (<kbd>ctrl</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd>)
* Only show commands acting on Lean files when a Lean file is open in the current editor
* Hole support

### 0.8.0
* Info view showing the current goal and error messages.
* Search command (<kbd>ctrl</kbd>+<kbd>p</kbd> `#`)
* Improved Unicode input.

### 0.7.2
* New input mode for Unicode symbols.
* Internally uses new [client library](https://github.com/leanprover/lean-client-js) to interact with the Lean server.

### 0.7.1
* Fixes issue with highlighting commands beginning with `#`.

### 0.7.0
* Support for controlling the "region of interest", i.e. which files
  are considered by the Lean server for checking and recompilation.
* Miscellaneous improvements to the grammar, and syntax highlighting
* Initial support for recording Lean server errors, and an option
  for displaying them upon crash.
* Support for more bracket pairs including many Unicode options.
* Properly set working directory when executing in batch mode.
* Configuration for controlling default region of interest.

### 0.6.6

* Use `semver` for detecting and comparing versions.
* Fix issue where diagnostics were not cleared on
  server restart.

### 0.6.5

Add support for detecting Lean server versions.

### 0.6.4

Add support for time and memory limits.

### 0.6.2

Consider angle brackets and parenthesis when completing Unicode symbols.

### 0.6.0

Bug fixes, stability, and a handful of feature improvements

### 0.4.0

Implement many features implemented by the EMACS mode. We now support:

- Hovering over names for type information
- Go-to-definition & peeking for constants
- Goal support, with the ability to display the
  goal at the current position.
- Basic auto-completion support
- Diagnostics support, displaying errors, information
   & warnings.

### 0.3.0

Add basic integration with the Lean server.

### 0.1.0

Initial release of the package.

-----------------------------------------------------------------------------------------------------------

## Contact

Please report issues on [Github](https://github.com/leanprover/vscode-lean).
