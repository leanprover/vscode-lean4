# Lean for VSCode

This extension adds support for [Lean](https://github.com/leanprover/lean).

## Features

We currently support:

* hovering
* completions
* diagnostics

<!--\!\[feature X\]\(images/feature-x.png\)-->

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

This extension contributes the following settings:

* `lean.executablePath`: controls which Lean executable is used when starting the server

## Known Issues

* We currently don't support Unicode input.
* Completion still behaves weirdly with hierarchial names

## Release Notes

### 0.4.0

Implement most features of the EMACS mode. We now support:

- Hovering over definitions for type information
- Go-to-definition & peeking for top-level constants
- Goal support, with the ability to display the
  goal at the current position in an output buffer.
- Basic completion support
- Diagnostics support, dispalying errors, information
  & warnings.

### 0.3.0

Added basic integration with the Lean server.

### 0.1.0

Initial release of the package.

-----------------------------------------------------------------------------------------------------------

## Contact

Feel free to report any issues on the tracker, email the Lean list, or me directly.
