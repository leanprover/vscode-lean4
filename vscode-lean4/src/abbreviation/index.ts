import { Disposable, languages } from 'vscode';
import { autorunDisposable } from '../utils/autorunDisposable';
import { AbbreviationHoverProvider } from './AbbreviationHoverProvider';
import { AbbreviationProvider } from './AbbreviationProvider';
import { AbbreviationRewriterFeature } from './rewriter/AbbreviationRewriterFeature';
import { AbbreviationConfig } from './config';

export class AbbreviationFeature {
	private readonly disposables = new Array<Disposable>();

	constructor() {
		const config = new AbbreviationConfig();
		const abbrevations = new AbbreviationProvider(config);

		this.disposables.push(
			autorunDisposable((disposables) => {
				disposables.push(
					languages.registerHoverProvider(
						config.languages.get(),
						new AbbreviationHoverProvider(config, abbrevations)
					)
				);
			}),
			new AbbreviationRewriterFeature(config, abbrevations)
		);
	}

	dispose(): void {
		for (const d of this.disposables) {
			d.dispose();
		}
	}
}
