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

## Building the client
- Run `npm install` in this folder. This installs all necessary npm modules.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the client.
- Switch to the Debug viewlet (Ctrl+Shift+D).
- Select `Launch Client` from the drop down.
- Run the launch config.

## Changelog
### 0.0.31 (Jun 7, 2021)
- Changes `\.` to be the unicode abbreviation shorthand for `\centerdot`, not `\cdot`, since the former is used more commonly in Lean 4.
  (Commits: [4e649](https://github.com/leanprover-community/vscode-lean4/commit/4e649d3d71afd6caae23c889fbd2d248c991bb6f))

### 0.0.30 (Jun 4, 2021)
- Fixes a bug where the task gutter could fire twice.
  (Commits: [640c5](https://github.com/leanprover-community/vscode-lean4/commit/640c5eb6e8c0284e100e18c81658739b97213a3b))

### 0.0.29 (Jun 4, 2021)
- Adds support for term mode goals.
  (Commits: [ff81e](https://github.com/leanprover-community/vscode-lean4/commit/ff81edad1efc1ae40ce8e8328183381e6d50b15a))
- Adds support for the `$/lean/fileProgress` Lean 4 LSP request extension.
  (Commits: [e0886](https://github.com/leanprover-community/vscode-lean4/commit/e08862c076b55cfbe79dac480d080ff766136cd9))
- Debounces orange bars. (?)
  (Commits: [0ba5f](https://github.com/leanprover-community/vscode-lean4/commit/0ba5f754adfc5c0a8d756db02070ce9813cc2196))

### 0.0.28 (May 26, 2021)
- Adds an option `lean4.elaborationDelay` to configure the delay after which the Lean 4 server starts elaborating with all accumulated changes.
  (Commits: [a5c15](https://github.com/leanprover-community/vscode-lean4/commit/a5c15de2749da28341d116642e5f246f70b30f98))

### 0.0.27 (May 26, 2021)
- Fixes a bug where unicode abbreviations would sometimes not work after opening a file.
  (Commits: [9602f](https://github.com/leanprover-community/vscode-lean4/commit/9602fef7b57422903d8db82978a86e94600fb37c))

### 0.0.26 (May 10, 2021)
- Fixes a bug where `lean4.serverEnvPaths` was not used in determining the current Lean version for compatibility with [vscode-lean](https://github.com/leanprover/vscode-lean).
  (Commits: [01e99](https://github.com/leanprover-community/vscode-lean4/pull/24/commits/01e99360f20abcd287a5df983605ae154b1b567e))
- Fixes a bug where `lean4.serverEnvPaths` did not correctly append to the PATH for non-Windows systems.
  (Commits: [01e99](https://github.com/leanprover-community/vscode-lean4/pull/24/commits/01e99360f20abcd287a5df983605ae154b1b567e))
- Fixes a bug where the text cursor would jump around when the unicode abbreviation substitution fails.
  (Commits: [8c318](https://github.com/leanprover-community/vscode-lean4/commit/8c318c458880c2de836d910d6e73b7952d68463c))
- Refactors the Lean version check to use `execFile` instead of `exec`, hence avoiding usage of the shell.
  (Commits: [f7fea](https://github.com/leanprover-community/vscode-lean4/commit/f7feac122d92d8be667cb7b1f3b53968f8457dae), [7c1aa](https://github.com/leanprover-community/vscode-lean4/commit/7c1aaa18ed3ab0b24d2aff50127db76db2f87948))

### 0.0.25 (Apr 28, 2021)
- Adds the options `lean4.serverEnvPaths` and `lean4.serverEnv` for adding environment variables and PATH components to the Lean 4 server environment.
  (Commits: [71c10](https://github.com/leanprover-community/vscode-lean4/commit/71c109608acb63f87587d4011636e72744a666fd), [d82b0](https://github.com/leanprover-community/vscode-lean4/commit/d82b04a6b5e6f3eb23cf5bec585cf16b47385ee0), [42bdc](https://github.com/leanprover-community/vscode-lean4/commit/42bdcfd352a37cfc47d799f92d591d2ea4f530b7))

### 0.0.24 (Apr 20, 2021)
- Updates the `elan` URL to point to `leanprover/elan` instead of `Kha/elan`.
  (Commits: [11f1b](https://github.com/leanprover-community/vscode-lean4/commit/11f1baed9c4179e68d055c1b497effc7a6576dd7))
- Fixes a bug where the server reporting an empty diagnostic caused an error.
  (Commits: [ebafd](https://github.com/leanprover-community/vscode-lean4/commit/ebafd369c1b90f8a25420332896202efbac5023d))

### 0.0.23 (Apr 7, 2021)
- Ensures that the server stderr output is displayed in VSCode's output channel.
  (Commits: [89b37](https://github.com/leanprover-community/vscode-lean4/commit/89b374c3797079999ab2f56973dff0c3f0ac42cc))

### 0.0.22 (Apr 7, 2021)
- Ensures that goal state is re-fetched when the state of the document changed since the last goal request to the server.
  (Commits: [eafe2](https://github.com/leanprover-community/vscode-lean4/commit/eafe2e1980467d3851f175754ffb56c27d4c332b))

### 0.0.21 (Apr 7, 2021)
- Changes all occurrences of "info view" to "infoview".
  (Commits: [718dc](https://github.com/leanprover-community/vscode-lean4/commit/718dca01d9f72b084476dd0271e42e9b66a0e142))

### 0.0.20 (Mar 26, 2021)
- Fixes the syntax highlighting of `/-\n-/`.
  (Commits: [c3b7c](https://github.com/leanprover-community/vscode-lean4/commit/c3b7c99b11942ca670b4ad794bc744911b24ecf4))

### 0.0.19 (Mar 26, 2021)
- Replaces `webview-rpc` library with a custom RPC library.
  (Commits: [61607](https://github.com/leanprover-community/vscode-lean4/commit/61607dccd090191c4ef75bf6895b18f28d362cfc))

### 0.0.18 (Mar 25, 2021)
- Fixes commands `lean4.displayGoal` and `lean4.displayList` not working.
  (Commits: [ad954](https://github.com/leanprover-community/vscode-lean4/commit/ad9541a17272ec5011c235252cc7439da8bc5e8c))

### 0.0.17 (Mar 25, 2021)
- Fixes a bug where the client spammed the Lean 4 server with `textDocument/didOpen` notifications when using VSCode's Ctrl+Hover feature on definitions, grinding the server to a halt. The discussion can be found at [leanprover/lean4#367](https://github.com/leanprover/lean4/issues/367).
  (Commits: [c697a](https://github.com/leanprover-community/vscode-lean4/commit/c697ada101776175480584400d6e1778cbe1e4ac))
- Disables the broken inaccessible variable highlighting.
  (Commits: [234fe](https://github.com/leanprover-community/vscode-lean4/commit/234fe1bef007334a3775d0c236f9b9c430aa1f2e))

### 0.0.16 (Mar 24, 2021)
- Fixes a bug where line numbers were reported off-by-one in the infoview.
  (Commits: [93629](https://github.com/leanprover-community/vscode-lean4/commit/936296a95ec423979e2e702b0fbdfa8f127f08ce))
- Replaces the "Lean 4 server" in diagnostics with "Lean 4".
  (Commits: [80125](https://github.com/leanprover-community/vscode-lean4/commit/80125db7cb7d23dee71b8e9d7a7b9cd044ed6ab1))

### 0.0.15 (Mar 24, 2021)
- Adds support for the Lean 4 `fullRange` diagnostic field LSP extension. A discussion of this extension can be found at [leanprover/lean4#340](https://github.com/leanprover/lean4/pull/340).
  (Commits: [541e0](https://github.com/leanprover-community/vscode-lean4/commit/541e01a2fef87428676a59dd4fb86642d3387c11))

### 0.0.14 (Mar 22, 2021)
- Fixes a bug where goals would not be fully formatted when the "Copy to comment" infoview feature was used.
  (Commits: [ef24c](https://github.com/leanprover-community/vscode-lean4/commit/ef24c6e93eb222eac8799653858c94775071ba66))

### 0.0.13 (Mar 22, 2021)
- Fixes a bug where the info view would incorrectly display that it is loading.
  (Commits: [86234](https://github.com/leanprover-community/vscode-lean4/commit/86234acee6f67ae2ff7cfd8c3ca532de8bb5d123))
- Refactors `src/infoview.ts` by moving various config accessors to `src/config.ts`.
  (Commits: [3d7c4](https://github.com/leanprover-community/vscode-lean4/commit/3d7c4a618c06f87f5606c391cbf2a97d829c0a75))

### 0.0.12 (Mar 11, 2021)
- Fixes semantic highlighting scopes. (?)
  (Commits: [5a2a0](https://github.com/leanprover-community/vscode-lean4/commit/5a2a067be38bd905d914896600f279172105cc8c))

### 0.0.11 (Mar 11, 2021)
- Fixes a bug where VSCode would provide no textual highlighting if the Lean 4 language server does not respond to the document highlights request.
  (Commits: [2d7cf](https://github.com/leanprover-community/vscode-lean4/commit/2d7cf89f5d476556be3cfb02babc9ac36c5c51dd))

### 0.0.10 (Mar 11, 2021)
- Ports the task gutter of [vscode-lean](https://github.com/leanprover/vscode-lean)'s infoview.
  (Commits: [84c3b](https://github.com/leanprover-community/vscode-lean4/commit/84c3beddf823980e203b5f6ee16336d6f113da0e))
- Changes the highlighting of character literals to be highlighted like strings.
  (Commits: [8452c](https://github.com/leanprover-community/vscode-lean4/commit/8452ce5177b22c05a8d884ca73a38196dc160551))
- Fixes a bug where `deriving instance <...> for <...>` would highlight the rest of the file as a declaration name.
  (Commits: [8bbd2](https://github.com/leanprover-community/vscode-lean4/commit/8bbd28ebc1a151ef904f2230b066ee7e98f8da75))
- Slightly improves info view error handling.
  (Commits: [c3bc0](https://github.com/leanprover-community/vscode-lean4/commit/c3bc08695624939af39515296cda97051c3de63c))

### 0.0.9 (Mar 11, 2021)
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
  (Commits: [87c3a](https://github.com/leanprover-community/vscode-lean4/commit/87c3a89d103c401ad8996c7007675609c0bd403f), [6b9d6](https://github.com/leanprover-community/vscode-lean4/commit/6b9d606430b593caf36ca6d3cdc3aae039cf5e9d), [ee372](https://github.com/leanprover-community/vscode-lean4/commit/ee372b631a969668bf362cd501017fd330c1720d))

### 0.0.8 (Mar 10, 2021)
- Adds syntax highlighting to the following keywords: `initialize`, `builtin_initialize`, `global`, `local`, `scoped`, `show`, `have`, `from`, `suffices` and `nomatch`.
  (Commits: [24d48](https://github.com/leanprover-community/vscode-lean4/commit/24d48d3f1cc9ca70ac3b86be5b1e328eb1ad4890), [d5ee0](https://github.com/leanprover-community/vscode-lean4/commit/d5ee0cad6d38809abda7782991616828fcc3b946))

### 0.0.7 (Feb 20, 2021)
- Fixes a bug where the client would also request the goal state for non-Lean 4 files, causing server errors.
  (Commits: [b4a21](https://github.com/leanprover-community/vscode-lean4/commit/b4a21f8bd5226fcc565a0abb37c553865d7f400b))

### 0.0.6 (Feb 12, 2021)
- Implements a very basic infoview to display plaintext Lean 4 goals with basic highlighting, inaccessible variable highlighting. Includes a command `lean4.plainInfoView.toggleAutoUpdate` (Ctrl+Shift+T).
  (Commits: [90dbb](https://github.com/leanprover-community/vscode-lean4/commit/90dbbdf697f537af3294a3aea708c3b7d3985585))
- Fixes a bug where abbreviations would not activate because the extension did not set the language ID of the file yet.
  (Commits: [bdff8](https://github.com/leanprover-community/vscode-lean4/commit/bdff830e84f079701ed07de2665c220eb2ec7160))
- Refactor to move some behaviour from `src/extension.ts` to new files `src/leanclient.ts` and `src/config.ts`.
  (Commits: [90dbb](https://github.com/leanprover-community/vscode-lean4/commit/90dbbdf697f537af3294a3aea708c3b7d3985585))

### 0.0.5 (Feb 2, 2021)
- Fixes a bug where the abbreviation feature would replace abbreviations even in non-Lean 4 files.
  (Issue: [leanprover/vscode-lean#255](https://github.com/leanprover/vscode-lean/issues/255))
  (Commits: [ff052](https://github.com/leanprover-community/vscode-lean4/commit/ff052d7ad78afbea30e7a6e81e613fcdd6fc30fe))

### 0.0.4 (Jan 29, 2021)
- Adds syntax highlighting for the `noncomputable` keyword and definition names.
  (Commits: [cc7fa](https://github.com/leanprover-community/vscode-lean4/commit/cc7fad15182e5b52d7c2df779bc3aa2cff5cfc82))

### 0.0.3 (Jan 27, 2021)
- Fixes a bug where the compatibility layer parses the Lean version as provided by `lean -v` too restrictively, classifying some Lean 4 installations as invalid and disabling the extension.
  (Commits: [cc8bf](cc8bfda8d10e1165b357ca4205bcd8c9e1cb7b6e))

### 0.0.2 (Jan 26, 2021)
- Ports the rewrite of the abbreviation feature from [vscode-lean](https://github.com/leanprover/vscode-lean) to vscode-lean4.
  (Commits: [e049b](https://github.com/leanprover-community/vscode-lean4/commit/e049b42a14d829361500a7790e89e9f3d7bcd0d7), [9a87e](https://github.com/leanprover-community/vscode-lean4/commit/9a87e01d799aa23fc37db6a1ee039c5f85f02fbe), [58fb5](https://github.com/leanprover-community/vscode-lean4/commit/58fb51dd02f694b4290643b073b17ca714208e8b), [94fdc](https://github.com/leanprover-community/vscode-lean4/commit/94fdcd3cfdf3da54b5a0776b970d1d4384da638e), [8bebc](https://github.com/leanprover-community/vscode-lean4/commit/8bebc8a8aa1627aa2baf7b102bf7476d31f58381), [09b54](https://github.com/leanprover-community/vscode-lean4/commit/09b542f1226e9722bbf08fc5bfc9ec26fbaf8053), [e467c](https://github.com/leanprover-community/vscode-lean4/commit/e467ce2eb0cf03fa16039fa0bc599d4019450314), [850ed](https://github.com/leanprover-community/vscode-lean4/commit/850ed87ece95487e58eaaf211b296ef75a9e033c))

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
  (Commits: [8e502](https://github.com/leanprover-community/vscode-lean4/commit/8e502ba092b7e7a48129a7133183163521c23179), [ca654](https://github.com/leanprover-community/vscode-lean4/commit/ca65431edf56082d2f8ec469de8f00356cb59972), [caa83](https://github.com/leanprover-community/vscode-lean4/commit/caa8333777a289e5c36918ab6b113cbe4b49ce80), [c9a30](https://github.com/leanprover-community/vscode-lean4/commit/c9a30c3a4d8d154884c68146d2243ca4b39744ab), [27b21](https://github.com/leanprover-community/vscode-lean4/commit/27b219d9252ec1817952bb06d15cbff0b67166f4), [bbbe0](https://github.com/leanprover-community/vscode-lean4/commit/bbbe01708793b3020ab920abdc84d1cfc42cb0b5), [d367a](https://github.com/leanprover-community/vscode-lean4/commit/d367a51b0e079b5bdf98dbb774732a79c2442e0e), [0275b](https://github.com/leanprover-community/vscode-lean4/commit/0275b12c62e55ee1316ee652a163ef455a2f8ee4), [4a008](https://github.com/leanprover-community/vscode-lean4/commit/4a008d66c8e87f31db2261178f49f91205883098), [9bc6b](https://github.com/leanprover-community/vscode-lean4/commit/9bc6b60f14c596a86ac87ed259c197b2037f17ba), [d3148](https://github.com/leanprover-community/vscode-lean4/commit/d3148eb9d94b2d3ad222927d5b8fbf26fce5fa52), [3db30](https://github.com/leanprover-community/vscode-lean4/commit/3db30c4587ec5309055e97474f4506dac256a299), [e10c3](https://github.com/leanprover-community/vscode-lean4/commit/e10c3bdf0487547f46680b1a83537ca99f9d38b6), [85bd3](https://github.com/leanprover-community/vscode-lean4/commit/85bd3efba15c1f5c64855e53c7304442a3d6f568), [faa26](https://github.com/leanprover-community/vscode-lean4/commit/faa26f2cd0e6f4669b05e0de494da6e0689d9372), [bd65f](https://github.com/leanprover-community/vscode-lean4/commit/bd65f5578bccc7be06e8a181181c4af874b8d0d9), [8d827](https://github.com/leanprover-community/vscode-lean4/commit/8d82758eaf4c6f2b6370ae06142babab9674ff94))