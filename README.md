# Lean for VSCode

This extension adds support for [Lean](https://github.com/leanprover/lean).

## Features

We currently support

* hovering
* completions
* diagnostics

<!--\!\[feature X\]\(images/feature-x.png\)-->

## Requirements

This extension requires an installation of Lean.

## Extension Settings

This extension contributes the following settings:

* `lean.executablePath`: controls which Lean executable is used when starting the server
* `lean.timeLimit`: controls the `-T` flag passed to the Lean executable
* `lean.memoryLimit`: controls the `-M` flag passed to the Lean executable

## Known Issues

* Completion still behaves weirdly with hierarchial names

## Release Notes

### 0.6.6

* Use `semver` for detecting and comparing versions.
* Fix issue where diagnostics were not cleared on
  server restart.

### 0.6.5

Add support for detecting Lean server versions.

### 0.6.4

Add support for time and memory limits.

### 0.6.2

Consider angle brackets and parenthesis when completing unicode symbols.

### 0.6.0

Bug fixes, stability, and a handful of feature improvements
TBD

### 0.4.0

Implement many features implemented by the EMACS mode. We now support:

- Hovering over names for type information
- Go-to-definition & peeking for constants
- Goal support, with the ability to display the
  goal at the current position.
- Basic auto-completion support
- Diagnostics support, displaying errors, information
   & warnings.

### 0.3.0

Add basic integration with the Lean server.

### 0.1.0

Initial release of the package.

-----------------------------------------------------------------------------------------------------------

## Contact

Please report issues on Github, for questions or concerns you can email the
Lean mailing list, or send @jroesch mail directly.
