# External Contribution Guidelines

These guidelines are for contributions to the Lean 4 VS Code extension from outside the Lean FRO. They help us to keep the code of the extension correct and maintainable.

## Helpful links

- [Development](docs/dev.md): build, test and debug the extension
- [Tests](vscode-lean4/test/README.md): run and write tests
- [Commit convention](#commit-convention)
- [Manual](vscode-lean4/manual/manual.md): the features of the extension

## Before you submit a pull request (PR)

**Start with an issue**: Before you submit a PR, open an issue about the problem or the feature. If you propose a new feature, use the [RFC template](https://github.com/leanprover/vscode-lean4/issues/new?template=rfc.md) (request for comments, title prefix `RFC:`). Ask other users for feedback, and write a summary of all feedback. This summary helps the maintainers to evaluate your proposal. In an RFC, answer these questions:

- **User experience**: How does the feature improve the user experience?
- **Beneficiaries**: Which Lean users and projects get the most benefit from the feature or change?
- **Community feedback**: Did you ask other Lean users for feedback?
- **Maintainability**: Does the change make the code easier to maintain, or does it simplify the structure of the code?

If the problem is in Lean itself, for example in the Lean language server, open the issue in the [lean4 repository](https://github.com/leanprover/lean4/issues).

**Understand the project**: Read the code, the open issues and the latest commits. Make sure that your contribution agrees with the direction and the priorities of the project.

**Stay up to date**: Regularly merge the latest changes of the `master` branch into your branch. Then we can integrate your branch without problems.

## Quality over quantity

**Focused changes**: Each PR must address one clearly defined issue or feature. Do not put unrelated changes into one PR.

**Write tests**: Each new feature and each bug fix must come with tests. The [test README](vscode-lean4/test/README.md) explains how to write and run them.

**Documentation**: Update the documentation that your change affects:

- Comments in the code that explain the logic of your change and the reason for it
- The [manual](vscode-lean4/manual/manual.md), for features that users can see
- The setup guide (`vscode-lean4/media/guide-*.md`), for changes to the installation of Lean or to the setup of projects
- The descriptions of settings and commands in `vscode-lean4/package.json`

## Compatibility with Lean versions

**The extension must work with all stable releases of Lean since Lean 4.0.0.** This also applies to the InfoView. Users open projects that use old Lean versions, and the extension must continue to support these projects.

Your change can use a feature that only newer Lean versions have. In this case, make sure that the Lean server supports the feature before you use it. The capabilities of the server show which features it supports (`leanServerCapabilities()` in `vscode-lean4/src/leanclient.ts`). If the server does not support the feature, the extension must continue to work as before.

If your change affects the communication with the Lean server, test it with an old Lean version too. For example, use the toolchain `leanprover/lean4:v4.0.0` in the `lean-toolchain` file of a test project.

## Coding standards

**Follow the code style**: Use the code style of the project. ESLint and Prettier enforce most of it. `npm install` installs a Git pre-commit hook that runs ESLint and Prettier on the staged files. To run the lint yourself, run `npm run build:dev` and then `npm run lint`. CI runs the same lint.

**Use what exists**: Use the VS Code API, `vscode-languageclient` and the utilities of the extension (for example in `vscode-lean4/src/utils/`). Do not write a new implementation of something that they already provide.

**Reusable packages**: `lean4-infoview`, `lean4-infoview-api`, `lean4-unicode-input` and `lean4-unicode-input-component` are npm packages that other projects also use. Do not use the VS Code extension API in these packages. A change to their API can break the other projects.

**Performance**: Make sure that your changes do not make the extension slower. If possible, optimize the solution for speed and resource usage.

**Platforms**: The extension runs on Linux, macOS and Windows. If your change uses file paths, processes or shell commands, make sure that it works on all three platforms. CI runs the tests on Ubuntu and Windows.

## PR submission

**Descriptive title and summary**: The PR title must briefly explain the purpose of the PR. The summary must give more detailed information about what the PR changes and why. A link to a Zulip thread is not a summary. You are responsible for the summary of the discussion, and for getting support for your change.

**Follow the commit convention**: We squash merge PRs. The commit message is the PR title and the PR description. Thus they must follow the [commit convention](#commit-convention). Put questions and extra information that must not go into the commit message into a first comment, not into the PR description. Because we squash the PR, you do not need to polish the commits on your branch.

**Link to relevant issues**: Reference the issues that your PR addresses.

**AI contributions**: If generative AI contributed to the final PR, write this in the PR description. Authors are responsible for a manual check of these contributions before they open a PR. PRs that only AI authored are not welcome, and we can close them without further comment.

**Stay responsive**: After you submit the PR, reply to feedback and be prepared to make the necessary changes. We can close a PR if its author did not reply or update it for more than one month.

## Commit convention

We use a simplified version of the [commit convention of lean4](https://github.com/leanprover/lean4/blob/master/doc/dev/commit_convention.md). A commit message has this format:

```
<type>: <subject>

<body>

<footer>
```

`<type>` is one of these words:

- `feat`: a new feature
- `fix`: a bug fix
- `doc`: documentation
- `test`: tests
- `refactor`: a change of the code that does not change its behavior
- `perf`: a performance improvement
- `chore`: maintenance, for example a change of the CI workflows or an update of a dependency

`<subject>` has these rules:

- Use the imperative, present tense: "change", not "changed" or "changes".
- Do not capitalize the first letter.
- Do not put a period at the end.

The release workflow makes the release notes from the commit subjects. Thus, write the subject for users of the extension.

`<body>` gives the reason for the change. It also compares the new behavior with the previous behavior.

`<footer>` is optional. It can contain these items:

- Breaking changes: Describe each breaking change, the reason for it and how to migrate.
- Closed issues: Put them on a separate line that starts with `Closes`, for example `Closes #123, #456`.

## Reviews and feedback

The Lean FRO maintains vscode-lean4. The maintainers read new bug reports, RFCs and PRs.

We close an issue if it is already fixed, if it is not a problem, or if it does not agree with our plans. We then do not work on it, and we do not accept external contributions for it.

General guidelines for reviews and feedback:

**Be patient**: The number of maintainers is small. Thus a review can take some time.

**Engage constructively**: Reply to feedback positively and constructively. Reviews make sure that the project has the best quality. They are not personal criticism.

**Continuous integration**: Make sure that all CI checks pass on your PR. Failed checks delay the review. The maintainers do not review PRs with failed checks.

## What to expect

**Not all PRs get merged**: We appreciate every contribution, but we do not merge all PRs. Make sure that your changes agree with the goals and the quality standards of the project.

**Feedback is a gift**: Feedback improves the project. It can also help you to grow as a developer or contributor.

**Community involvement**: Talk with the Lean community on the [Lean Zulip](https://leanprover.zulipchat.com). This can give better collaboration and a better understanding of the direction of the project.
