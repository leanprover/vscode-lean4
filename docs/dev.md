# Development

This page is designed for software developers who are helping to develop this Lean VS Code extension.

The repository contains NPM packages implementing editor integration for the Lean 4 programming language. The VS Code
extension proper is in [`vscode-lean4`](vscode-lean4/), while [`lean4-infoview`](lean4-infoview/) implements the
information display. The API glue code between them is in [`lean4-infoview-api`](lean4-infoview-api/). We build
the packages in tandem using NPM workspaces.

![overview](images/overview.png)

See the following design topics:
- [bootstrapping](bootstrapping.md)

### Building
- Make sure you have an up to date installation of `npm` and `node.js`.  For example `npm` version 8.1.3 and `node.js` version v16.13.0.
- Run `npm install` in your workspace root folder to set up the project's dependencies.
- Run `npm run build`. This compiles the extension (which is necessary for go-to-definition in VS Code).

### Testing
- Make sure you have executed the above build steps
- Run `npm run test`.  If you want to see incremental output run this in the `vscode-lean4` folder.
- See [test readme](vscode-lean4/test/readme.md) for more information.

Note that the tests use 2 versions of lean in order to test version switching using Select Toolchain.
These versions are controlled by the `test/test-fixtures/simple/lean-toolchain` and
`test/test-fixtures/multi/foo/lean-toolchain` files respectively.  Updating those will move the tests
to newer versions of lean.

### Debugging
- Complete the 'Building' instructions above.
- Open VS Code on this folder.
- Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> to compile the extension. (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> on macos.) This step is needed for a working development setup.
- Press F5 to launch the extension in the VS Code debugger, (the correct launch.json configuration is already checked into this repo.)

To debug the tests use the launch configuration named `Extension Tests - SuiteName`.

**Note:** if breakpoints are not working, try changing one line of code in `function activate` in `extension.ts`, even
adding a newline seems to work, then press F5.

## Packaging

To publish the extension on the VS Code marketplace you
should run the `./release.sh` script.

See [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for more information.

You can build a local .vsix for testing using `npm run package` in the `vscode-lean4/` subdirectory.

This gives you a .vsix which you can install using the VS Code
command `Extensions: Install from VSIX...`.

## Troubleshooting

**[!] SyntaxError: Cannot use import statement outside a module**

On Windows the build can fail if the path in your Terminal window has the wrong "case" on the drive letter.
For example, if your terminal was started in `d:\git\leanprover\vscode-lean4` and you get this error then
try and start your terminal using an upper case driver letter like this: `D:\git\leanprover\vscode-lean4`.
Then the build should succeed.  This is an open [bug in Rollup](https://github.com/rollup/rollup/issues/4439).

**Tests failing**

Try wiping your `.elan` folder and start over running all tests in order using `npm run tests`. This
could fix some things, for example, if you have an incompatible default lean toolchain.  The
bootstrapping test needs to be run first then all other tests should be fine.  Once you've done this
then you can run and debug random tests from VS Code.
