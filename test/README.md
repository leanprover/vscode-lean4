# VS Code Lean Tests

This is the beginning of some integration tests for the VS Code Lean 4 extension.

## Running the tests

- Run `npm install` in terminal to install dependencies
- Run `npm run test` in termnal to run the tests

## Debugging the tests

- Run the `Debug Tests` target in the Debug View. This will:
	- Start a task `npm: watch` to compile the code
	- Run the extension integration test in a new VS Code window so you can debug them.
