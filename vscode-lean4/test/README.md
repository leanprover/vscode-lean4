# VS Code Lean Tests

This folder contains some integration tests for the VS Code Lean 4 extension.  These tests follow
the examples provided in [Testing VS Code
Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension).

The tests launch a new test installed version of VS Code (not your regular VS code) where this test
install lives in a local `.vscode-test` folder, and it has it's own user data in there also. So the
first time you run the tests you will see it download the latest version of VS code into that
folder.  It launches this test version with a `--extensionDevelopmentPath` option pointing to the
`vscode-lean4` folder so that the local version of the extension you have build loads into VS code
for testing.  All this is setup by the [runTests.ts](src/runTests.ts) program.

The test folder is organized into:
- **suite** - for the actual test code.
- **test-fixtures** - contains Lean sample projects used by the tests.

The following is a description of the tests:
- **suite/lean3** - tests that the lean3 extension loads and the lean4 extension does not get in the way.
- **suite/simple**:
  - `Untitled Lean File` tests that the lean4 extension loads correctly for adhoc files, and untitled files, and that the infoview opens and contains the right output, so this is an end-to-end test ensuring the lean language service is running.  It also tests that you can `Goto Definition` to the Lean source code for `Lean.versionString` and that this takes you to `leanprover--lean4---nightly`.
  - `Orphaned Lean File` tests we can open a Lean 4 file in a folder that has no inherited `lean-toolchain` version information and that you get the `default` toolchain in this case.
  - `Goto definition in a package folder` tests opening a folder containing a Lean 4 project, and that goto definition works across files in the project.
- **suite/toolchains**:
  - `Untitled Select Toolchain` tests the `Lean4: Select Toolchain` command when editing an untitled file.
  - `Restart Server` tests the `Lean4: Restart Server` command.
  - `Select toolchain` tests the `Lean4: Select Toolchain` command can override the lean version used in one of those projects and that this override can be reset.
  - `Edit lean-toolchain version` tests that when you edit the `lean-toolchain` file and specify a
  different version that the lean server is restarted with that new version.
- **suite/multi**:
  - `Load a multi-project workspace` tests lean4 works in a multi-folder VS code workspace where each folder in the workspace uses a different version of lean.  It verifies that 2 separate LeanClients are running in this case each using the correct version of
  the Lean toolchain specified in the `lean-toolchain` in each folder.

## Running the tests

To run the tests you must first follow the build steps in [../readme.md](../readme.md).

For these tests to pass on your machine you need to:
- install the lean3 extension
- install `leanprover/lean4:nightly` toolchain
- install `leanprover/lean4:stable` toolchain
- ensure you have a `default` Lean4 toolchain
- create a linked toolchain named `master` that points to a build of lean4 bits on your machine.
See [on-push.yml](../../.github/workflows/on-push.yml) for example of how to set that up).

Now you can run `npm run test` and you will get some handy console output of the test run.

The first time you run the test this way it will download a test version of vscode
and place it in a temporary folder `.vscode-test/`.

## Debugging the tests

- Run the `Debug Tests` target in the Debug View. This will use the `watchTest` build task to:
	- Run `tsc -p . --outDir out` to ensure test code is up to date
	- Start a `npm watch` task to compile the vscode-lean4 extension and watch for changes.
	- Run the extension integration test in a new VS Code window so you can debug the tests.

Depending on which test it is you want to debug you may have to edit the `Debug Tests` launch
configuration in `launch.json`.  Be sure to match the arguments there with the way the test
is launched in `runtests.ts`.

You will be able to set breakpoints in everything except the `runtests.ts` file which is a kind of
[@vscode/test-electron](https://github.com/microsoft/vscode-test) bootstrapping program.

While these tests can use most VS Code API's to send commands, find windows, edit text, the tests
cannot "close a folder" or "the workspace" or do "developer: reload window" because those operations
will cause an infinite loop as the test itself gets reloaded and runs again.
