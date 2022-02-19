# VS Code Lean Tests

This is the beginning of some integration tests for the VS Code Lean 4 extension.

## Running the tests

You cannot run the tests while another instance of VS Code is open, so first close
all VS code windows and run the following from a terminal window:

- Run `npm install` to install dependencies
- Run `npm run test` to run the tests

The first time you run the test this way it will download a test version of vscode
and place it in a temporary folder `.vscode-test/`.

## Debugging the tests

- Run the `Debug Extension Tests` target in the Debug View. This will:
	- Start a task `npm: watch` to compile the code
	- Run the extension integration test in a new VS Code window so you can debug the tests.
