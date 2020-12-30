export function assert(condition: () => boolean): void {
	if (!condition()) {
		const msg = `Assert failed: "${condition.toString()}" must be true, but was not!`;
		console.error(msg);
		throw new Error(msg);
	}
}
