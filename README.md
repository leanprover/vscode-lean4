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

## Known Issues

* Completion still behaves weirdly with hierarchial names

## Release Notes

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
- Diagnostics support, dispalying errors, information
   & warnings.

### 0.3.0

Add basic integration with the Lean server.

### 0.1.0

Initial release of the package.

-----------------------------------------------------------------------------------------------------------

## Contact

Please report issues on Github, for questions or concerns you can email the
Lean mailing list, or send @jroesch mail directly.
