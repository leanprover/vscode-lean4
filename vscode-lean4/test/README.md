# vscode-lean4 tests

Integration tests run inside a VS Code Extension Development Host via `@vscode/test-cli`.

## Layout

- `vscode-test-cli/` — default suite. Assumes Elan is already installed on the host. Runs on every CI job.
- `wdio/` — UI-driven tests via `wdio-vscode-service` (the only place that can reach into WebViews like the infoview).
- `nightly/` — exercises the real Elan + toolchain install flow. Gated behind `LEAN4_TEST_ELAN_INSTALL=1`. Runs nightly / on merge.
- `helpers/` — shared utilities; see the helper map below.
- `fixtures/` — on-disk workspace fixtures opened by the test host.

## Isolation

`.vscode-test.mjs` creates a fresh per-run directory under `~/.cache/lean4-vscode-tests/` and points `HOME`, `USERPROFILE`, and `ELAN_HOME` at it. The developer's real `~/.elan` and `~/.vscode` are never touched. (We do not use `os.tmpdir()` because distros like Fedora and Arch mount `/tmp` as tmpfs with a quota smaller than a Lean toolchain; downloads there fail with `Quota exceeded`.) Test homes accumulate under that cache dir and can be deleted freely when not running tests.

## Running

```bash
# Default (assumes elan is installed; no real network install)
npm test

# Nightly tests (downloads elan + leanprover/lean4:stable, ~200MB)
npm run test:nightly
```

Before running `test:nightly` locally, execute `scripts/check-nightly-test-preconditions.sh` for a quick sanity check.

### Toolchain pinning policy

Every fixture under `test/fixtures/*/lean-toolchain` pins the floating channel `leanprover/lean4:stable`. We deliberately do not pin a specific version — the goal is to **notice when a new Lean stable release breaks the extension** rather than insulating the test suite from Lean releases.

To keep this honest under CI caching, the `.github/workflows/test.yml` `test` job queries `https://release.lean-lang.org/` for the current stable name and bakes it into the elan cache key. When Lean publishes a new stable, the cache key rotates and elan downloads the new toolchain on the next run — so failures attributable to a stable upgrade surface immediately rather than waiting for a calendar-based cache eviction. `restore-keys` falls back to the previous stable's cache so the rotation only re-downloads the new toolchain itself, not the entire elan install.

The two non-`:stable` fixtures (`mock-lean3-project`, `mock-ancient-lean4-project`) are deliberate mocks created via `elan toolchain link` and don't drift.

If a regression DOES surface immediately after a Lean stable release, the fix is usually in the extension. If the new stable is genuinely broken in a way that's not the extension's responsibility, pin the offending fixture(s) to the prior version (`leanprover/lean4:vX.Y.Z`) until upstream resolves it, then revert the pin.

### Headless on Linux

Running `npm test` directly opens real VS Code windows that grab focus from your DE for the duration of the suite. The `test:headless`, `test:headless:wdio`, `test:headless:nightly`, and `test:headless:elan-install` scripts wrap the equivalent commands in `xvfb-run -a` so the test instances render to a virtual X display instead — no focus-stealing, no taskbar entries. Requires `xorg-x11-server-Xvfb` (Fedora) / `xvfb` (Debian/Ubuntu); not available on macOS or Windows.

`.vscode-test.mjs` and `wdio.conf.mjs` unconditionally pass `--ozone-platform=x11` to Electron on Linux. Without it, modern VS Code Electron builds default to `--ozone-platform-hint=auto` and prefer Wayland whenever `WAYLAND_DISPLAY` is set — including under `xvfb-run`, which only sets `DISPLAY` and doesn't unset Wayland-side env. The flag is safe outside `xvfb-run` too: X11 still works on Wayland sessions via XWayland, so the only visible effect is that test instances always go through the X stack.

Failure debugging is unaffected: `vscode-test-cli-output/<test>.json` and `wdio-output/` (junit + screenshots + VS Code logs) capture the same state with or without a visible window. Details in the next section.

## Failure artifacts

Test output and on-failure dumps go to two gitignored directories under `vscode-lean4/`, both wiped at the start of each run and uploaded by CI as artifacts.

### `vscode-test-cli-output/`

Populated by the vscode-test-cli suite (covers `cli-*` and `nightly` / `elan-install` labels).

**Per-label summary** — at the end of every `npm run test:vscode-test-cli` (and via the parent `npm test`), `scripts/runCliTests.mjs` prints a table of per-label exit codes plus a re-emit of any failed label's mocha failure block, so the actual assertion + stack trace appears at the bottom of the terminal scrollback rather than scrolled off:

```
────────────────────────────────────────
vscode-test-cli summary
────────────────────────────────────────
  ✘ cli-abbreviation       4.0s  (exit 1)
  ✔ cli-launch-modes       18.1s
  …

  8/9 labels passed
  failed: cli-abbreviation

────────────────────────────────────────
failure detail: cli-abbreviation
────────────────────────────────────────
  1 failing
  1) Abbreviation feature
       …:
     AssertionError: expected 'X', got 'Y'
        at …
```

**Per-test state-dump JSON** — `helpers/teardown.ts:dumpStateIfFailed` runs in every test's `afterEach(afterEachReset)` and, when the just-finished test failed, writes `<safe-test-name>.json` capturing the workbench's textual state at the point of failure:

- `test`: title, parent describe, error stack/message
- `diagnostics`: every URI's diagnostics (severity, message, range, source) — covers all open Lean files, not just the one under test
- `activeEditor`: `{ uri, cursor, text }` for the focused editor
- `visibleEditors`: every visible editor's `{ uri, viewColumn, cursor }`
- `openDocuments`: every doc in `workspace.textDocuments` (`{ uri, languageId, isDirty, lineCount }`)
- `outputChannels`: per-channel transcript of every write the extension made via `vscode.window.createOutputChannel` (see below)

The dump is a JSON snapshot — pixels are skipped because vscode-test-cli failures are diagnostic/text-driven, not visual.

**Output channel transcripts** — `helpers/outputChannels.ts:startOutputChannelCapture` (called from `helpers/activation.ts`) wraps `window.createOutputChannel` so every write to any channel is (a) accumulated in memory for the state dump above, (b) mirrored to the test runner's stdout in real time as `[output:<channel name>] <text>`. So a CI transcript reads like a user session — you see what the extension was logging at every step, not just on failure.

### `wdio-output/`

Populated by `wdio.conf.mjs`:

- `wdio-junit-<cid>.xml` — junit XML for every wdio test (always, success or failure).
- `<safe-test-name>.png` — failure screenshot saved by the `afterTest` hook whenever `result.error` is set.
- `vscode-logs/` — VS Code's own log files (extension host, renderer) routed here via the `--logs-path` launchArg, so a CI failure can grep these for extension-host crashes / LSP errors / unhandled rejections.

Both directories are uploaded as a single GitHub Actions artifact per CI job.

## Prompt stubbing

Tests that reach code showing an info/warning/error notification wrap the call in `withPrompts([...], async ({ log }) => { … })`. The array is a scripted queue of answers, and every interaction is printed to stdout so the CI transcript reads like a user session.

### `waitForPrompt` vs. `assertPromptFired`

Two flavors of "did this prompt fire" exist; pick the one that matches your awaited command:

- **`assertPromptFired(log, { kind, messagePattern, chose | dismissed })` — strict, synchronous.** Use after `await commands.executeCommand(…)` when the command's promise only resolves *after* the prompt has been consumed. Fails immediately if no matching entry exists in the log. Pass `chose: '<button label>'` to require a specific button, or `dismissed: true` to require the prompt was dismissed (no button picked) — they're mutually exclusive; omit both for "no constraint."
- **`waitForPrompt(log, predicate, timeoutMs, label)` — polling.** Use when the command under test returns while the prompt is still in flight (for example, an unrelated fire-and-forget info notification that the command surfaces on a background promise). Polls the log up to `timeoutMs`.

If you're not sure which applies, prefer `assertPromptFired`. The common failure mode for a misplaced `assertPromptFired` is a loud, immediate failure with the full log dumped; a misplaced `waitForPrompt` silently burns its timeout.

### Answer forms

`withPrompts(answers, …)` accepts three answer forms:

- **Function `(message, items) => string | undefined`** — recommended when disambiguation matters. Inspect the message first, then return a button label. The function form prevents matching the wrong button when several prompts share an item label — it does *not* re-queue itself: every answer (including a function returning `undefined`) is consumed once per prompt that fires. If you script `[fn]` and an unanticipated prompt fires before the one `fn` was meant for, `fn` is consumed against the wrong prompt and the next prompt sees an empty queue (which throws under strict mode — script the full sequence or pass `dismissRemaining`).
- **RegExp** — matches against *button labels*, not the message. Fragile if a later prompt also has a button matching the same regex; prefer the function form for anything that could run after another prompt.
- **String** — exact button-label match.

`withQuickPicks(answers, …)` follows the same shape but matches against `QuickPickItem.label`. For `window.createQuickPick` (stateful API used by `projectinit.ts`) use `stubStatefulQuickPick(selectLabel)`.

### Strict by default; `dismissRemaining` to opt out

Both `withPrompts` and `withQuickPicks` throw when a prompt or pick fires after the answer queue is exhausted. This catches regressions where production code adds a new notification the test didn't anticipate — silent-dismiss would have masked it.

For flows that surface incidental notifications the test doesn't care about (e.g. post-init "Open new project folder", post-build "built successfully" follow-up), pass `{ dismissRemaining: true }` as the trailing argument:

```ts
await withPrompts([], async ({ log }) => {
    await commands.executeCommand('lean4.project.build')
    assertPromptFired(log, { kind: 'info', messagePattern: /built successfully/ })
}, { dismissRemaining: true })
```

The empty-array idiom `withPrompts([], …, { dismissRemaining: true })` is the canonical "I don't care which prompts fire, dismiss everything" form. Without `dismissRemaining`, an empty answer array means "no prompts should fire" — any prompt is a test failure.

## Helper map

| Helper | Use it when |
|---|---|
| `activation.activateExtension()` | Every suite's `before()` — replaces the `getExtension` + `assert.ok` + `activate` boilerplate. |
| `editors.closeAllEditors()` | `afterEach()` — resets "no editor open" so the next case starts fresh. |
| `client.openAndAwaitClient(uri, timeoutMs)` | You need to open a file *and* have a running Lean client for it before proceeding. |
| `client.getClientProvider()` | You want to reach into `LeanClientProvider` to compare client identities (see `launch-modes.test.ts`). |
| `lsp.waitForDiagnostics(uri, predicate, timeoutMs)` | "Open this fixture and observe its diagnostics" cases — short-circuits if the current state already matches, which correctly inherits leftover state from prior tests that opened the same URI. |
| `lsp.waitForDiagnosticsAfter(uri, action, predicate, timeoutMs)` | Actions that genuinely change LSP state (`lean4.restartFile` / `lean4.restartServer`, edits triggering re-elaboration). Subscribes BEFORE `action`, resolves on a post-action fire — a no-op `action` produces no fire and times out, which is the desired regression-detector behaviour. Do NOT use for plain file-opens — `workspace.openTextDocument` is idempotent for an already-open doc and won't trigger a fire. |
| `prompts.withPrompts(answers, fn)` | Tests that should not have to manage `capturePrompts()` restoration manually. |
| `prompts.assertPromptFired(log, expected)` / `prompts.waitForPrompt(log, …)` | See the "Prompt stubbing" section. |
| `quickPicks.withQuickPicks(answers, fn)` | `showQuickPick` callers — mirrors `withPrompts`. |
| `quickPicks.stubStatefulQuickPick(label)` | Code that calls `window.createQuickPick` (stateful API). |
| `dialogs.withSaveDialog(uri, fn)` / `dialogs.withOpenDialog(uris, fn)` | `window.showSaveDialog` / `showOpenDialog` callers — single-shot answer (no queue), captures every invocation in `capture.log`, restores the stub on success and on body throw. |
| `testHome.requireIsolatedTestHome({ requireElanHome? })` | Any test that mutates elan state — fails loudly if the safety marker is missing. |
| `testHome.makeTestWorkDir(prefix)` | Throwaway project fixtures. Lives under `LEAN4_TEST_HOME`; leaked on purpose (the test-home is wiped between runs). |
| `git.git(cwd, …args)` / `gitText(…)` / `initGitRepo(dir)` | Spawn a real `git` for setup fixtures (`file://` deps, `Initial commit` assertions). |
| `timeouts.*` | `FIRST_DIAGS_TIMEOUT_MS`, `DIAGS_TIMEOUT_MS`, `RESTART_DIAGS_TIMEOUT_MS`, `CLIENT_READY_MS` — shared constants so CDN/latency changes can be adjusted in one place. |
| `typing.typeChars(text)` / `waitForText(doc, …)` | Abbreviation-rewriter tests. |
| `wdio.*` | All the wdio InfoView helpers (`openFixtureFile`, `moveCursorTo`, `waitForInfoView`, `withInfoView`, `isInfoViewOpen`, `runCommand`). |
