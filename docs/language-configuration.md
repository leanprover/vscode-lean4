This document serves as documentation for [`language-configuration.json`](/vscode-lean4/language-configuration.json).

See [the official VS code documentation](https://code.visualstudio.com/api/language-extensions/language-configuration-guide) for an overview of how `language-configuration.json` files work in general.

Section titles here are top-level fields in the JSON file, and link to their corresponding section in the official documentation.

## [`onEnterRules`](https://code.visualstudio.com/api/language-extensions/language-configuration-guide#on-enter-rules)

This field specifies a list of rules which determine how lines should be indented when the user presses <kbd>Enter</kbd>. When the text in a line before the cursor is matched by the regex specified in a rule's `beforeText`, that rule's `action` is applied on <kbd>Enter</kbd>.

### Focus blocks

```json
{
    "beforeText" : "^\\s*(·|\\.)\\s.*$",
    "action" : { "indent" : "indent" }
}
```

This rule ensures that hitting enter after starting a focus block during a tactic sequence produces a line within that focus block. I.e.,

```
  constructor
  · intro x| <-- hit enter here
    | <-- cursor ends up here
```
