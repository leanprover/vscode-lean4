# Usage
1. Add a new `contenteditable` div to your HTML that serves as the input: `<div id="unicode-input" contenteditable="true"></div>`
2. Import `InputAbbreviationRewriter` from this package and create a new `InputAbbreviationRewriter` for `#unicode-input`
3. Make sure to call `InputAbbreviationRewriter.resetAbbreviations` whenever setting the text of `#unicode-input` programmatically, as the `InputAbbreviationRewriter` only triggers on actual user input
4. Style `#unicode-input` to your liking

This component only supports single-line input and no rich text styling other than the abbreviation highlighting.
