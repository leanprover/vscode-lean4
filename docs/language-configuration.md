This document serves as documentation for [`language-configuration.json`](/vscode-lean4/language-configuration.json).

See [the official VS code documentation](https://code.visualstudio.com/api/language-extensions/language-configuration-guide) for an overview of how `language-configuration.json` files work in general.

Section titles here are top-level fields in the JSON file, and link to their corresponding section in the official documentation.

## [`brackets`](https://code.visualstudio.com/api/language-extensions/language-configuration-guide#brackets-definition), [`autoClosingPairs`](https://code.visualstudio.com/api/language-extensions/language-configuration-guide#autoclosing), and [`surroundingPairs`](https://code.visualstudio.com/api/language-extensions/language-configuration-guide#autosurrounding)

All of these fields handle brackets in different ways.

* `brackets`: determines highlighting and selection
* `autoClosingPairs`: specifies which bracket pairs should prompt automatic insertion of a closing bracket upon typing the initial bracket
* `surroundingPairs`: specifies which brackets should surround highlighted content when typed (e.g. highlighting a term then typing <kbd>(</kbd> should surround the term with parentheses)

### Markdown

We include the following only in `surroundingPairs`:

```json
    ...
    ["`", "`"],
    ["*", "*"],
    ["_", "_"]
    ...
```

This means that you can highlight text in comments and italicize, bold, or code-format it easily by typing the respective marker(s). We don't want to use these as actual brackets or autoclosing pairs, however, due to their use in Lean code.
