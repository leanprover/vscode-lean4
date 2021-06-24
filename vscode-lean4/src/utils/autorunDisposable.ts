import { autorun } from 'mobx';
import { Disposable } from 'vscode';

/**
 * Like `autorun`, but more suited for working with Disposables.
 * The `disposables` passed to `reaction` will be disposed when the reaction is triggered again.
 */
export function autorunDisposable(
	reaction: (disposables: Disposable[]) => void
): Disposable {
	let lastDisposable = new Array<Disposable>();
	return {
		dispose: autorun(() => {
			for (const d of lastDisposable) {
				d.dispose();
			}
			lastDisposable = [];
			reaction(lastDisposable);
		}),
	};
}
