# VS Code Lean Tests

This folder contains some integration tests for the VS Code Lean 4 extension.  These tests follow
the examples provided in [Testing VS Code
Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension).

The tests launch a new test installed version of VS Code (not your regular VS code) where this test
install lives in a local `.vscode-test` folder, and it has its own user data in there also. So the
first time you run the tests you will see it download the latest version of VS code into that
folder.  It launches this test version with a `--extensionDevelopmentPath` option pointing to the
`vscode-lean4` folder so that the local version of the extension you have build loads into VS code
for testing. All this is setup by the [runTests.ts](src/runTests.ts) program.

The test folder is organized into:
- **suite** - for the actual test code.
- **test-fixtures** - contains Lean sample projects used by the tests.

The following is a description of the tests:
- **suite/simple**:
  - `Untitled Lean File` tests that the lean4 extension loads correctly for adhoc files, and untitled files, and that the infoview opens and contains the right output, so this is an end-to-end test ensuring the lean language service is running.  It also tests that you can `Goto Definition` to the Lean source code for `Lean.versionString` and that this takes you to `leanprover--lean4---nightly`.
  - `Orphaned Lean File` tests we can open a Lean 4 file in a folder that has no inherited `lean-toolchain` version information and that you get the `default` toolchain in this case.
  - `Goto definition in a package folder` tests opening a folder containing a Lean 4 project, and that goto definition works across files in the project.
- **suite/toolchains**:
  - `Edit lean-toolchain version` tests that when you edit the `lean-toolchain` file and specify a
  different version that the lean server is restarted with that new version.
- **suite/multi**:
  - `Load a multi-project workspace` tests lean4 works in a multi-folder VS code workspace where each folder in the workspace uses a different version of lean.  It verifies that two separate LeanClients are running in this case each using the correct version of
  the Lean toolchain specified in the `lean-toolchain` in each folder.

## Running the tests

To run the tests you must first follow the build steps in [../readme.md](../readme.md).

For these tests to pass on your machine you need to:
- install `leanprover/lean4:nightly` toolchain
- install `leanprover/lean4:stable` toolchain
- ensure you have a `default` Lean4 toolchain

Now you can run `npm run test` and you will get some handy console output of the test run.

The first time you run the test this way it will download a test version of vscode
and place it in a temporary folder `.vscode-test/`.
