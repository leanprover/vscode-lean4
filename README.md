<style type='text/css'>
@font-face {
	font-family: "codicon";
	src: url("vscode-lean4/media/codicon.ttf") format("truetype");
}

.codicon[class*='codicon-'] {
	font: normal normal normal 16px/1 codicon;
	display: inline-block;
	text-decoration: none;
	text-rendering: auto;
	text-align: center;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
	user-select: none;
	-webkit-user-select: none;
	-ms-user-select: none;
}
.codicon-pin:before { content: "\eb2b" }
.codicon-pinned:before { content: "\eba0" }
.codicon-go-to-file:before { content: "\ea94" }
.codicon-debug-pause:before { content: "\ead1" }
.codicon-debug-continue:before { content: "\eacf" }
.codicon-refresh:before { content: "\eb37" }
.codicon-quote:before { content: "\eb33" }
</style>

# Lean 4 VSCode Extension
This extension provides VSCode editor support for the Lean 4 programming language.
It is based on [vscode-lean](https://github.com/leanprover/vscode-lean).

## Installing the extension and Lean 4
1. Install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=leanprover.lean4).
1. Open a folder containing .lean code using VS Code.
1. Open a `.lean` file and type in `#eval 1`. The extension should display a blue underline below `#eval`. Upon hovering over it, a hover panel reporting the result of the evaluation should pop up. When hovering over the `1`, a hover panel displaying the type of `1` should pop up.
1. If `Lean` is not yet installed on your system you will see a prompt like this:
![prompt](vscode-lean4/media/install-elan.png)
1. Click the "Install Lean using Elan" option and enter any options that appear
in the terminal window, including any information about changing your PATH
environment to point to the `elan` bin folder.  If you do need to change your PATH
you many need to restart VS code to pick up that new environment.
1. After this succeeds the correct version of Lean will be installed by `elan`
and you should see something like this in the `Lean: Editor` output channel:
    ```
    info: downloading component 'lean'
    info: installing component 'lean'
    Lean (version 4.0.0-nightly-2021-10-18, commit e843fb7ca5b5, Release)
    ```
1. If you want to use a local version of Lean that you built yourself then
use the `elan toolchain link name path` command and then use the VS Code
`Lean4: Select Toolchain` command to select the toolchain name you defined.

    ![select-toolchain](vscode-lean4/media/select-toolchain.png)

1. This version of the VS Code extension only works on Lean 4 source files and not
Lean 3.  There is a separate VS Code extension for Lean 3.

Note that once `elan` is installed you can also create a Lean 4 project using [leanpkg](https://leanprover.github.io/lean4/doc/setup.html#leanpkg) or [Lake](https://github.com/leanprover/lake/blob/master/README.md).  The VS code extension will honor the lean version specified in your
project files.

## Features

The extension supports the following features.
For basic VS Code editor features, see the [VS Code User Interface docs](https://code.visualstudio.com/docs/getstarted/userinterface).

The extension provides nice integration with the Lean language server
shown below and :
- A set of handy `Lean4:` commands available with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>
- Side-by-side compatibility with the [Lean 3 VSCode extension](https://github.com/leanprover/vscode-lean)

## Lean language server features

- Automatic installation of Lean using [elan](https://github.com/leanprover/elan).
- Incremental compilation and checking via the Lean server (1)
- Type information & documentation on hover
- Error messages and diagnostics
- Syntax highlighting with basic Lean 4 syntax rules
- `\foo` unicode shortcuts
- Semantic highlighting
- Hover shows documentation, types and Unicode input help:
  ![hover_example](vscode-lean4/media/hover-example.png)
- Auto-completion drops downs based on context and type via the Lean Server.
For example, if you type "." after `Array` you will get:
  ![completion-example](vscode-lean4/media/completion-example.png)
- An infoview displaying useful information about your current Lean program.
- Go to definition (F12)
- [Breadcrumbs](https://code.visualstudio.com/Docs/editor/editingevolved#_breadcrumbs)

(1) Incremental updates do not yet work automatically across files, so after changing and rebuilding the dependency of a
Lean 4 file, the language server needs to be manually informed that it should re-elaborate the full file, including the
imports. This can be done using the `Lean 4: Refresh File Dependencies` command, which can be activated via <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>
by default.

## Lean editing features

- Support for completing abbreviations starting with a backslash (\\).
For example you type '\alpha` and the editor pops in the nice Unicode character
(α).
- Support for completing the closing brace, like `()`, `{}` and `[]`

## Info view panel

The info view panel is essential to working interactively with Lean. It shows:
- tactic state widgets, with context information (hypotheses, goals) at each point in a proof / definition,
  - **Expected type** widgets display the context for subterms.
  - the types of sub-terms in the context can be inspected interactively using mouse hover.
- **All Messages** widget, which shows all info, warning, and error messages from the Lean server, and
- Support for any custom Html widgets returned by the Lean program itself (coming soon..)

Suppose you have the following theorem from

```lean
theorem test (p q : Prop) (hp : p) (hq : q) : p ∧ q ∧ p :=
  by apply And.intro
     exact hp
     apply And.intro
     exact hq
     exact hp
```

and you place the cursor at the end of the line `by apply And.intro` the Info View will display the following information:

![completion-example](vscode-lean4/media/infoview-overview.png)

1. The info view will activate automatically when a Lean file is opened, but you can also reopen it any time using the icon in the top right of the text editor window or the <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> `Lean 4: Infoview: Display Goal` command or the key that is bound to the command, which is <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> by default.

2. Copy-to-comment: click <a class="link pointer mh2 dim codicon codicon-quote" title="copy state to comment"></a> to copy the contents of the widget to a comment in the editor.

3. Pin / unpin: click <a class="link pointer mh2 dim codicon codicon-pin" title="pin"></a> to split off a "pinned" tactic state widget, which tracks the tactic state at a fixed position, even if you move your cursor away.  You will see two new icons:

    - Unpin: <a class="link pointer mh2 dim codicon codicon-pinned" title="unpin"></a>  to remove the pinned widget from the info view.

    - Reveal file location: <a class="link pointer mh2 dim codicon codicon-go-to-file" title="reveal file location"></a> to move the cursor in the editor to the pinned location in the file.

4. Pause / continue: clicking <a class="link pointer mh2 dim codicon codicon-debug-pause" title="pause updating"></a> will prevent the tactic state widget from updating when the file is edited. Click  to resume updates.  Once paused you can then click <a class="link pointer mh2 dim codicon codicon-debug-continue" title="pause updating"></a> to resume updates.

5. Update: clicking <a class="link pointer mh2 dim codicon codicon-refresh" title="update"></a> will refresh the tactic state of the pinned widget.

6. Same as 4.

7. Types in the context can be examined in the tactic state widget using mouse hover:

![inspect-term-example](vscode-lean4/media/inspect-term-example.png)

8. The "All Messages" widget can be expanded by clicking on it (or hitting the keybind for `lean4.displayList`, which is <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> by default


## Extension Settings

## Extension Settings

This extension contributes the following settings (for a complete list, open the VS Code Settings and scroll to "Lean configuration"):

### Server settings

* `lean4.executablePath`: specifies the name of the Lean executable to be used when starting the Lean language server. Most users (i.e. those using `elan`) should not ever need to change this. If you are bundling Lean and `vscode-lean` with [Portable mode VS Code](https://code.visualstudio.com/docs/editor/portable), you might find it useful to specify a relative path to Lean. This can be done by starting this setting string with `%extensionPath%`; the extension will replace this with the absolute path of the extension folder. For example, with the default directory setup in Portable mode, `%extensionPath%/../../../lean` will point to `lean` in the same folder as the VS Code executable / application.

* `lean4.serverEnv`: specifies any Environment variables to add to the Lean 4 language server environment.  Note that when opening a remote folder using VS Code the Lean 4 language server will be running on that remote machine.

* `lean4.serverEnvPaths`: specifies any additional paths to add to the Lean 4 language server environment PATH variable.  Note that when opening a remote folder using VS Code the Lean 4 language server will be running on that remote machine.

* `lean4.serverArgs`: specifies any additional arguments to pass on the `lean --server` command line.

* `lean4.serverLogging.enabled`: specifies whether to do additional logging of
commands sent to the Lean 4 language server. The default is `false`.

* `lean4.serverLogging.path`: if `serverLogging.enabled` is true this provides the
name of the relative path to the store the logs.

### Input / editing settings

* `lean4.input.enabled`: enables abbreviation input completion mode.  For example, it allows  you to type `\alpha` and have that be replaced with the greek letter (α).

* `lean4.input.eagerReplacementEnabled`: enables/disables eager replacement as soon as the abbreviation is unique (`true` by default)

* `lean4.input.leader`: character to type to trigger abbreviation input completion input mode (`\` by default).

* `lean4.input.languages`: specifies which VS Code programming languages the abbreviation input completion will be used in.  The default is [`lean4`, `lean`].

* `lean4.input.customTranslations`: add additional input Unicode translations. Example: `{"foo": "☺"}` will correct `\foo` to `☺` (assuming the `lean.input.leader` has its default value `\`).

* `lean4.typesInCompletionList`: controls whether the types of all items in the list of completions are displayed. By default, only the type of the highlighted item is shown.

### Info view settings

* `lean4.infoViewAutoOpen`: controls whether the info view is automatically displayed when the Lean extension is activated for the first time in a given VS Code workspace(`true` by default).  If you manually close the infoview it will stay closed for that workspace until.  You can then open it again using the <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> `Lean 4: Infoview: Display Goal` command.

* `lean4.infoViewAutoOpenShowGoal`: auto open shows goal and messages for the current line (instead of all messages for the whole file).  In this mode the InfoView updates often every time you move the cursor to a different position so it can show context sensitive information.  Default is `true`.

* `lean4.infoViewTacticStateFilters`: An array of objects containing regular expression strings that can be used to filter (positively or negatively) the plain text tactic state in the info view. Set to an empty array `[]` to hide the filter select dropdown. Each object must contain the following keys:
  - `regex` is a properly-escaped regex string,
  - `match` is a boolean, where `true` (`false`) means blocks in the tactic state matching `regex` will be included (excluded) in the info view,
  - `flags` are additional flags passed to the [JavaScript RegExp constructor](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp).
  - The `name` key is optional and may contain a string that is displayed in the dropdown instead of the full regex details.

* `lean4.infoViewFilterIndex`: Index of the filter applied to the tactic state (in the array infoViewTacticStateFilters). An index of -1 means no filter is applied (which is the default for this setting).

* `lean4.infoViewAllErrorsOnLine`: show all errors on the current line, instead of just the ones on the right of the cursor, default `true`.

* `lean4.elaborationDelay`: Time (in milliseconds) which must pass since latest edit until elaboration begins. Lower values may make editing feel faster at the cost of higher CPU usage.  The default is 200.


## Extension commands

This extension also contributes the following commands, which can be bound to keys if desired using the [VS Code keyboard bindings](https://code.visualstudio.com/docs/getstarted/keybindings).

The format below is: "`lean4.commandName` (command name): description", where `lean.commandName` represents the name used in `settings.json` and "command name" is the name found in the [command palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) (accessed by hitting <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).

### Server commands

* `lean4.restartServer` (Lean 4: Restart Server): restart the Lean 4 Language Server. Useful if the server crashes or if you built new `.olean` files in your workspace.

* `lean4.refreshFileDependencies` (Lean 4: Refresh File Dependencies): This command is a work around for the fact that full incremental updates do not yet work automatically across files, so after changing and rebuilding the dependency of a
Lean 4 file, the language server needs to be manually informed that it should re-elaborate the full file, including the
imports. This command has a default keyboard binding of <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>.

& `lean4.selectToolchain` (Lean 4: Select Lean Toolchain) Select version of the Lean toolchain to use for the current workspace.  This shows the list of available toolchains returned from `elan toolchain list` and allows you to easily switch. The Lean 4 language server will automatically be restarted using the selected toolchain.  This command also provides a choice labelled `Custom` where you can enter the full path to a Lean 4 executable to use instead.  This choice is remembered in your [Workspace Settings](https://code.visualstudio.com/docs/getstarted/settings) and you can reset any custom path by setting `Custom` back to the string `lean`.

### Editing commands

* `lean4.input.convert` (Lean 4: Input: Convert Current Abbreviation): converts the current abbreviation (bound to <kbd>tab</kbd> by default)

### Info view commands

* `lean4.displayGoal` (Lean 4: Infoview: Display Goal): open the info view panel (bound to <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> by default)

* `lean4.displayList` (Lean 4: Infoview: Toggle "All Messages"): toggles the "All messages" widget in the info view (bound to <kbd>ctrl</kbd>+<kbd>alt</kbd>+<kbd>shift</kbd>+<kbd>enter</kbd> by default)

* `lean4.infoView.copyToComment` (Lean 4: Infoview: Copy Contents to Comment"): if there is a valid value in the Info View marked with the <a class="link pointer mh2 dim codicon codicon-quote" title="copy state to comment"></a> icon that can be copied to a comment, this command invokes that action in the editor.

* `lean4.infoView.toggleStickyPosition` (Lean 4: Infoview: Toggle Pin): enable / disable "sticky" mode. On enable, a tactic state widget will be created and pinned to this position, reporting the goal from this point even as the cursor moves and edits are made to the file. On disable the pinned widget will be removed. (same as clicking on the <a class="link pointer mh2 dim codicon codicon-pin" title="pin"></a> or <a class="link pointer mh2 dim codicon codicon-pinned" title="pin"></a> icon on the tactic state widget closest to the cursor.)

* `lean4.infoView.toggleUpdating` (Lean 4: Infoview: Toggle Updating): pause / continue live updates of the main (unpinned) tactic state widget (same as clicking on the <a class="link pointer mh2 dim codicon codicon-debug-pause" title="pause updating"></a> or <a class="link pointer mh2 dim codicon codicon-debug-continue" title="pause updating"></a> icon on the main tactic state widget.)


## For VS Code Extension developers

The rest of this page is for the developers of the Lean 4 VS Code Extension.

The repository contains NPM packages implementing editor integration for the Lean 4 programming language. The VS Code
extension proper is in [`vscode-lean4`](vscode-lean4/), while [`lean4-infoview`](lean4-infoview/) implements the
information display. We build the packages in tandem using Lerna.

### Building
- Run `npm install` in this folder. This installs the Lerna package manager.
- Run `npx lerna bootstrap`. This sets up the project's dependencies.
- Run `npx lerna run build`. This compiles the extension (which is necessary for go-to-definition in VS Code).

### Debugging
- Open VS Code on this folder.
- Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> to compile the extension. This step is needed for a working development setup.
- Press F5 to launch the extension in the VS Code debugger, (the correct launch.json configuration is already checked into this repo.)

**Note:** if breakpoints are not working, try changing one line of code in `function activate` in `extension.ts`, even
adding a newline seems to work, then press F5.
