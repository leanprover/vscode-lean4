# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies (run from repo root)
npm install

# Build all packages
npm run build

# Watch mode for development (rebuilds on file changes)
npm run watch

# Lint all TypeScript/TSX files
npm run lint

# Package as .vsix for local install testing (from vscode-lean4/)
cd vscode-lean4 && npm run package
```

## Testing

The full test framework is documented in `vscode-lean4/test/README.md`. Read it once before authoring or debugging tests — it covers prompt stubbing, the helper map, and the per-file VS Code instance model. The summary below covers the day-to-day commands and how to diagnose failures.

### Running tests locally

Always use the `test:headless*` variants on Linux. Plain `npm test` opens real VS Code windows that grab focus from your DE for the duration of the suite (`xorg-x11-server-Xvfb` / `xvfb` package required; not available on macOS or Windows).

```bash
# Full suite: vitest unit tests + infoview tsc check + grammar + vscode-test-cli + wdio.
npm run test:headless

# Just the wdio (UI/InfoView) subset, from vscode-lean4/.
npm run test:headless:wdio --workspace=lean4

# Nightly suite (real network: elan install, lake clone, mathlib cache). Gated
# behind LEAN4_TEST_ELAN_INSTALL=1 internally; the script sets it.
npm run test:headless:nightly --workspace=lean4

# Just the elan-install subset (a smaller scope of the nightly).
npm run test:headless:elan-install --workspace=lean4

# Vitest only — pure-TypeScript tests, no VS Code, no xvfb needed.
npm run test:unit

# Single vscode-test-cli file (replace <name>):
cd vscode-lean4 && xvfb-run -a npx vscode-test --label cli-<name>
# e.g. cli-abbreviation, cli-launch-modes, cli-project-actions
# (label list comes from filenames under test/vscode-test-cli/)
```

`npm ci` does not build workspace `dist/` directories; both type-aware lint and the `lean4-infoview` tsc check require them. Run `npm run build:dev` (or `npm run build`) first if you've just cloned or run `npm ci`.

### Diagnosing test failures

The framework writes failure artifacts to two gitignored directories under `vscode-lean4/`. Both are wiped at the start of each run.

- **`vscode-test-cli-output/`** — populated by every `vscode-test-cli` and `nightly` test. On failure, `helpers/teardown.ts:dumpStateIfFailed` writes `<safe-test-name>.json` with the workbench's textual state at the failure point: diagnostics for every URI, active editor (uri/cursor/text), visible/open editors, and per-channel transcripts of every write the extension made via `window.createOutputChannel`. The output channels are also mirrored to the test runner's stdout in real time as `[output:<channel name>] <text>` — so the CI transcript reads like a live session.
- **`wdio-output/`** — populated by the wdio suite. Always: `wdio-junit-<cid>.xml` (junit), `vscode-logs/` (extension host + renderer logs from `--logs-path`). On failure: `<safe-test-name>.png` (workbench screenshot from `afterTest`).

`runCliTests.mjs` re-emits the failure detail of any failed `cli-*` label at the bottom of the run, so a single assertion is the last thing in the scrollback rather than scrolled off behind nine labels' output.

### Diagnosing CI failures

CI runs on three jobs in `.github/workflows/test.yml` (`test`, `nightly`, `elan-install-windows`) plus `lint`/`package` in `.github/workflows/on-push.yml`. All three test-job artifacts (`vscode-test-cli-output/`, `wdio-output/`, plus the raw stdout) are uploaded for inspection.

For a failure, follow this order:

1. **Read the captured `[output:<channel>] …` lines** in the job log around the failing test. Lake stdout, LSP server output, and the extension's own diagnostics flow through here. Often the assertion is downstream of an earlier `error:` line that names the actual cause (e.g., a network failure or a missing toolchain step).
2. **Download the artifact zip** via the GitHub Actions UI and unzip locally. The `vscode-test-cli-output/<safe-test-name>.json` for a failed test contains the post-failure workbench state in JSON form.
3. **For wdio failures**, look at the saved screenshot first — it shows what the workbench looked like at failure time, including any unexpected modal, focus state, or partial render. Pair it with `vscode-logs/` for renderer / extension-host errors.
4. **For "doesn't reproduce locally"**, the most common causes are: workspace `dist/` not built before the failing step (CI's fresh runner has empty `dist/`; `npm ci` does not build); `LEAN4_TEST_HOME_OVERRIDE` set to a path inside an outer git repo (CI sets it to `${{ github.workspace }}/.lean4-test-home`, which is inside the actions/checkout clone — `setupTestHome.mjs` sets `GIT_CEILING_DIRECTORIES` to defang this); GitHub-hosted runner image changes; or a Lean stable release that broke a fixture (the toolchain pin policy is documented in `test/README.md`).

If a test failure points at a production-code bug, **do not modify `*/src/**`** unless explicitly asked. Almost every "looks like a production bug" turns out to be a test-environment difference (missing build step, isolated home boundary, env not propagated to a child process). Fix the harness instead.

## Architecture

This is a **Lerna monorepo** with npm workspaces containing five packages:

### Packages

| Package | Role |
|---|---|
| `vscode-lean4/` | VS Code extension entry point, LSP client, project management |
| `lean4-infoview/` | React-based infoview WebView (reusable, no VS Code dependency; rendered in the side panel) |
| `lean4-infoview-api/` | Shared TypeScript types/interfaces for editor↔infoview communication |
| `lean4-unicode-input/` | Unicode abbreviation engine (reusable, no VS Code dependency) |
| `lean4-unicode-input-component/` | React component wrapping the abbreviation engine (reusable, no VS Code dependency) |

### VS Code and LSP Information

- `vscode-lean4/package.json` is the declarative manifest configuration file of the VS Code extension
- `vscode-lean4/src/extension.ts` contains the main function of the VS Code extension (`activate()`)
- Information on the VS Code API can be found in the following places:
  - TypeScript API: `node_modules/@types/vscode/index.d.ts` or https://code.visualstudio.com/api/references/vscode-api 
  - Fields of `vscode-lean4/package.json`: https://code.visualstudio.com/api/references/extension-manifest
  - Contribution points in `vscode-lean4/package.json`: https://code.visualstudio.com/api/references/contribution-points
  - Activation events in `vscode-lean4/package.json`: https://code.visualstudio.com/api/references/activation-events
  - `when` clauses in `vscode-lean4/package.json`: https://code.visualstudio.com/api/references/when-clause-contexts
- Information on LSP (Language Server Protocol) can be found at https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
- A Lean specification of the implementation of LSP that is used by the Lean language server can be found at https://raw.githubusercontent.com/leanprover/lean4/refs/heads/master/src/Lean/Server/ProtocolOverview.lean

### Extension Activation Flow (`vscode-lean4/src/extension.ts`)

1. `activate()` registers always-on features (abbreviations, diagnostics, installer, project init, etc.)
2. It then lazily activates Lean 4 features only when a Lean document or project is detected
3. `LeanClientProvider` (`src/utils/clientProvider.ts`) maintains **one `LeanClient` per project folder**, managing the LSP lifecycle for each
4. `LeanClient` (`src/leanclient.ts`) wraps `vscode-languageclient` to communicate with the `lake serve` process

### Infoview Communication

The infoview runs in a VS Code WebView and communicates with the extension host through a custom RPC layer:
- `lean4-infoview-api` defines the `EditorApi` (editor→infoview calls) and `InfoviewApi` (infoview→editor calls) interfaces
- `vscode-lean4/src/rpc.ts` implements the bidirectional RPC mechanism over `postMessage`
- `vscode-lean4/src/infoview.ts` (`InfoProvider`) manages the WebView panel and implements `EditorApi`
- `lean4-infoview/src/infoview/editorConnection.ts` implements the infoview side

### Key Source Directories

- `vscode-lean4/src/utils/` — utilities: LSP converters, URI helpers, project detection, installer logic, elan management
- `vscode-lean4/src/diagnostics/` — setup/precondition checks shown when the extension first activates
- `vscode-lean4/src/abbreviation/` — abbreviation feature (Unicode input via `\` leader key)
- `vscode-lean4/syntaxes/` — TextMate grammars: `lean4.json` (main), `lean4-markdown.json` (~2250 lines, markdown inside Lean comments), `codeblock.json`
- `vscode-lean4/webview/` — WebView entry point bundled by webpack into `dist/`
- `lean4-infoview/src/infoview/` — React components for goals, messages, widgets, tooltips, trace explorer

### Build System

- **`vscode-lean4`**: webpack bundles the extension and the infoview WebView separately; the infoview dist is copied from `lean4-infoview/dist/` by `CopyPlugin`
- **`lean4-infoview`**: rollup bundles the React infoview
- **`lean4-unicode-input`** and **`lean4-unicode-input-component`**: TypeScript compiled directly
