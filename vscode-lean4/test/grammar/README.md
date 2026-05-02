# Grammar snapshot tests

Uses [`vscode-tmgrammar-test`](https://github.com/PanAeon/vscode-tmgrammar-test) to lock tokenization of the TextMate grammars shipped in `syntaxes/`.

## Layout

- `*.lean` — source fixtures.
- `*.lean.snap` — generated snapshots; committed and diff-checked in CI.

## Commands

```bash
cd vscode-lean4
npm run test:grammar            # check: fails if tokenization drifts from the snapshots
npm run test:grammar:update     # regenerate snapshots (use when the drift is intended)
```

## Adding a fixture

1. Add a `.lean` (or `.md`, if covering the markdown grammar separately) file to this directory with a clear file-level comment explaining what regression it guards against.
2. Run `npm run test:grammar:update` to produce the `.snap` file.
3. Inspect the `.snap` — verify every scope is what you expect before committing.
4. Commit both files together.

## When a CI run fails

The tool prints a diff of expected vs actual scopes. Either:

- **Fix the grammar** if the change was unintended, or
- **Run `npm run test:grammar:update`** and commit the new snapshot if the change was deliberate.
