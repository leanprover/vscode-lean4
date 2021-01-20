import { computed } from 'mobx';
import { Disposable } from 'vscode';
import { autorunDisposable } from '../utils/autorunDisposable';
import * as abbreviations from './abbreviations.json';
import { SymbolsByAbbreviation, AbbreviationConfig } from './config';

/**
 * Answers queries to a database of abbreviations.
 */
export class AbbreviationProvider implements Disposable {
	private readonly disposables = new Array<Disposable>();
	private cache: Record<string, string | undefined> = {};

	constructor(private readonly config: AbbreviationConfig) {
		this.disposables.push(
			autorunDisposable(() => {
				// For the livetime of this component, cache the computed's
				const _ = this.symbolsByAbbreviation;
				// clear cache on change
				this.cache = {};
			})
		);
	}

	@computed
	private get symbolsByAbbreviation(): SymbolsByAbbreviation {
		// There are only like 1000 symbols. Building an index is not required yet.
		return {
			...abbreviations,
			...this.config.inputModeCustomTranslations.get(),
		};
	}

	getAllAbbreviations(symbol: string): string[] {
		return Object.entries(this.symbolsByAbbreviation)
			.filter(([abbr, sym]) => sym === symbol)
			.map(([abbr]) => abbr);
	}

	findSymbolsIn(symbolPlusUnknown: string): string[] {
		const result = new Set<string>();
		for (const [abbr, sym] of Object.entries(this.symbolsByAbbreviation)) {
			if (symbolPlusUnknown.startsWith(sym)) {
				result.add(sym);
			}
		}
		return [...result.values()];
	}

	/**
	 * Computes the replacement text for a typed abbreviation (excl. leader).
	 * This converts the longest non-empty prefix with the best-matching abbreviation.
	 *
	 * For example:
	 *   getReplacementText("alp") returns "α"
	 *   getReplacementText("alp7") returns "α7"
	 *   getReplacementText("") returns undefined
	 */
	getReplacementText(abbrev: string): string | undefined {
		if (abbrev in this.cache) {
			return this.cache[abbrev];
		}
		const result = this._getReplacementText(abbrev);
		this.cache[abbrev] = result;
		return result;
	}

	private _getReplacementText(abbrev: string): string | undefined {
		if (abbrev.length === 0) {
			return undefined;
		}

		const matchingSymbol = this.findSymbolsByAbbreviationPrefix(abbrev)[0];
		if (matchingSymbol) {
			return matchingSymbol;
		}

		// Convert the `alp` in `\alp7`
		const prefixReplacement = this.getReplacementText(
			abbrev.slice(0, abbrev.length - 1)
		);
		if (prefixReplacement) {
			return prefixReplacement + abbrev.slice(abbrev.length - 1);
		}

		return undefined;
	}

	getSymbolForAbbreviation(abbrev: string): string | undefined {
		return this.symbolsByAbbreviation[abbrev];
	}

	findSymbolsByAbbreviationPrefix(abbrevPrefix: string): string[] {
		const matchingAbbreviations = Object.keys(
			this.symbolsByAbbreviation
		).filter((abbrev) => abbrev.startsWith(abbrevPrefix));

		matchingAbbreviations.sort((a, b) => a.length - b.length);
		return matchingAbbreviations.map(
			(abbr) => this.symbolsByAbbreviation[abbr]
		);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
