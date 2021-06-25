This repository contains NPM packages providing editor integration for the Lean 4 programming language.

See [`vscode-lean4`](vscode-lean4/) and [`lean4-infoview`](lean4-infoview/).

## Building
- Run `npm install` in this folder. This installs the Lerna package manager.
- Run `npx lerna bootstrap`. This sets up the project's dependencies.
- Open VS Code on this folder.
- Press Ctrl+Shift+B to compile the extension.
- Switch to the Debug viewlet (Ctrl+Shift+D).
- Select `Launch Extension` from the drop down.
- Run the launch config.