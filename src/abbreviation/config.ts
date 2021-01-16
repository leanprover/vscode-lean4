import { serializerWithDefault, VsCodeSetting } from '../utils/VsCodeSetting';

/**
 * Exposes (observable) settings for the abbreviation feature.
 */
export class AbbreviationConfig {
	readonly inputModeEnabled = new VsCodeSetting('lean.input.enabled', {
		serializer: serializerWithDefault(true),
	});

	readonly abbreviationCharacter = new VsCodeSetting('lean.input.leader', {
		serializer: serializerWithDefault('\\'),
	});

	readonly languages = new VsCodeSetting('lean.input.languages', {
		serializer: serializerWithDefault(['lean']),
	});

	readonly inputModeCustomTranslations = new VsCodeSetting(
		'lean.input.customTranslations',
		{
			serializer: serializerWithDefault<SymbolsByAbbreviation>({}),
		}
	);

	readonly eagerReplacementEnabled = new VsCodeSetting(
		'lean.input.eagerReplacementEnabled',
		{
			serializer: serializerWithDefault(true),
		}
	);
}

export interface SymbolsByAbbreviation {
	[abbrev: string]: string;
}
