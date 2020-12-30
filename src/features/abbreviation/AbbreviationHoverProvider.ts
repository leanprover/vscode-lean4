import { HoverProvider, TextDocument, Position, Hover, Range } from 'vscode';
import { AbbreviationProvider } from './AbbreviationProvider';
import { AbbreviationConfig } from './config';

/**
 * Adds hover behaviour for getting translations of unicode characters.
 * Eg: "Type ⊓ using \glb or \sqcap"
 */
export class AbbreviationHoverProvider implements HoverProvider {
	constructor(
		private readonly config: AbbreviationConfig,
		private readonly abbrevations: AbbreviationProvider
	) {}

	provideHover(document: TextDocument, pos: Position): Hover | undefined {
		const context = document.lineAt(pos.line).text.substr(pos.character);
		const symbolsAtCursor = this.abbrevations.findSymbolsIn(context);
		const allAbbrevs = symbolsAtCursor.map((symbol) => ({
			symbol,
			abbrevs: this.abbrevations.getAllAbbreviations(symbol),
		}));

		if (
			allAbbrevs.length === 0 ||
			allAbbrevs.every((a) => a.abbrevs.length === 0)
		) {
			return undefined;
		}

		const leader = this.config.abbreviationCharacter.get();

		const hoverMarkdown = allAbbrevs
			.map(
				({ symbol, abbrevs }) =>
					`Type ${symbol} using ${abbrevs
						.map((a) => '`' + leader + a + '`')
						.join(' or ')}`
			)
			.join('\n\n');

		const maxSymbolLength = Math.max(
			...allAbbrevs.map((a) => a.symbol.length)
		);
		const hoverRange = new Range(pos, pos.translate(0, maxSymbolLength));

		return new Hover(hoverMarkdown, hoverRange);
	}
}
