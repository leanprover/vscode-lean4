import { serializerWithDefault, VsCodeSetting } from '../utils/VsCodeSetting';

/**
 * Exposes (observable) settings for the abbreviation feature.
 */
export class AbbreviationConfig {
	readonly inputModeEnabled = new VsCodeSetting('lean4.input.enabled', {
		serializer: serializerWithDefault(true),
	});

	readonly abbreviationCharacter = new VsCodeSetting('lean4.input.leader', {
		serializer: serializerWithDefault('\\'),
	});

	readonly languages = new VsCodeSetting('lean4.input.languages', {
		serializer: serializerWithDefault(['lean4', 'lean']),
	});

	readonly inputModeCustomTranslations = new VsCodeSetting(
		'lean4.input.customTranslations',
		{
			serializer: serializerWithDefault<SymbolsByAbbreviation>({}),
		}
	);

	readonly eagerReplacementEnabled = new VsCodeSetting(
		'lean4.input.eagerReplacementEnabled',
		{
			serializer: serializerWithDefault(true),
		}
	);
}

export interface SymbolsByAbbreviation {
	[abbrev: string]: string;
}
