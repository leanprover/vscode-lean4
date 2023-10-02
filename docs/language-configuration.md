This document serves as documentation for [`language-configuration.json`](/vscode-lean4/language-configuration.json).

See [the official VS code documentation](https://code.visualstudio.com/api/language-extensions/language-configuration-guide) for an overview of how `language-configuration.json` files work in general.

Section titles here are top-level fields in the JSON file, and link to their corresponding section in the official documentation.

## [`onEnterRules`](https://code.visualstudio.com/api/language-extensions/language-configuration-guide#on-enter-rules)

This field specifies a list of rules which determine how lines should be indented when the user presses <kbd>Enter</kbd>. When the text in a line before the cursor is matched by the regex specified in a rule's `beforeText`, that rule's `action` is applied on <kbd>Enter</kbd>.

### Postindented EOL tokens

Certain end-of-line (EOL) tokens require increased indentation on subsequent lines. Hence, we call them "postindented" here for brevity; this is not standard terminology.

The list of English-language postindented EOL tokens is:

* `by`, `do`, `try`, `finally`, `then`, `else`, `where`, `from`, `extends`, `deriving`, `termination_by`(`'`), `decreasing_by`

The list of symbolic postindented EOL tokens is:

* `:=`, `←`, `=>`, `::`, `<|`

We want to avoid misidentification of the English-language tokens as part of a name (e.g. `foo.try` or `entry`); we do, however, still want to recognize these tokens in cases like `... (by`. So, we make sure the English-language tokens are preceded by a word boundary and not by `.`. We also exclude `#`, since at least `#where` appears as a temporary command in std4. (`\b(?<!(\.|#))`)

Likewise, we demand that each symbolic token is preceded by a space to avoid clashes with other symbols.

However, since `onEnterRules` applies the rule that first matches, we first need to account for indentation after postindented EOL tokens which occur on the same line as focus blocks. In that case, we need one indentation for the focus block (see the [focus blocks](#focus-blocks) section), and another for the EOL token; VS Code currently only allows one indentation action, so we must use `appendText` to append an extra tab. Note that this is appropriately converted to spaces by VS code before insertion.

Note that not all of these tokens can actually be used after starting a focus block, but it's simpler to have one regex which appears in two places instead of two different ones.

```json
{
    "beforeText" : "^\\s*(·|\\.)\\s((.*\\b(?<!(\\.|#))(by|do|try|finally|then|else|where|from|extends|deriving|termination_by(')?|decreasing_by))|((.*\\s)?(:=|←|=>|::|<\\|)))\\s*$",
    "action" : { "indent" : "indent", "appendText": "\t" }
}
```

We can then account for postindented EOL tokens in the ordinary case.

```json
{
    "beforeText" : "^((.*\\b(?<!(\\.|#))(by|do|try|finally|then|else|where|from|extends|deriving|termination_by(')?|decreasing_by))|((.*\\s)?(:=|←|=>|::|<\\|)))\\s*$",
    "action" : { "indent" : "indent" }
}
```

Caveat: this produces incorrect indentation in the following case:

```
theorem foo (h : LongHypothesisList) :
    FooType :=| <-- hit enter here
  |   | <-- cursor winds up here
  ^-- cursor should be here
```

However, without access to the parser or multi-line matching (VS code limits the match to the line the cursor is on), there's no way to fix this.

### Type signatures

Multi-line type signatures in Lean are supposed to have non-initial lines indented twice. We can't account for all of these with `beforeText` regexes (which would at least require matching over multiple lines and balancing parentheses), but we can at least account for the following case:
```
theorem foo (h : LongHypothesisList) ... :| <-- hit enter here
    | <-- cursor ends up here
```
We want to make sure we don't apply this rule when already in a multi-line type signature:
```
theorem foo (h1 : LongHypothesisList) ...
    (h2 : LongHypothesisList2) ... :| <-- hit enter here
    | <-- cursor ends up here
```
To accomplish this we only match on lines which do not start with a binder bracket. (This doesn't account for cases where the type of a hypothesis itself spans multiple lines, but those cases typically require careful manual formatting anyway.)

First, however, we indent *three* times when starting a focus block; see the [focus blocks](#focus-blocks) section for more info. We use `appendText` to accomplish this; note that tabs are appropriately converted into spaces by VS code before insertion.

```json
{
    "beforeText" : "^\\s*(·|\\.)\\s.*\\s:\\s*$",
    "action" : { "indent" : "indent", "appendText": "\t\t" }
}
```

We then apply our standard rule:

```json
{
    "beforeText" : "^(?!\\s*(\\(|{|\\[|⦃)).*\\s:\\s*$",
    "action" : { "indent" : "indent", "appendText": "\t" }
}
```

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

We also make sure we indent twice after encountering a postindented EOL token, and three times after starting a type signature; see [postindented EOL tokens](#postindented-eol-tokens) and [type signatures](#type-signatures).
