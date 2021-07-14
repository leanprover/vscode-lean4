import { assert } from '../../utils/assert';

/**
 * A general purpose range implementation.
 * Is offset/length based in contrast to `vscode.Range` which is line/column based.
 */
export class Range {
	constructor(readonly offset: number, readonly length: number) {
		assert(() => length >= 0);
	}

	contains(offset: number): boolean {
		return this.offset <= offset && offset <= this.offsetEnd;
	}

	get offsetEnd(): number {
		return this.offset + this.length - 1;
	}

	get isEmpty(): boolean {
		return this.length === 0;
	}

	toString(): string {
		return `[${this.offset}, +${this.length})`;
	}

	move(delta: number): Range {
		return new Range(this.offset + delta, this.length);
	}

	moveKeepEnd(delta: number): Range {
		assert(() => delta <= this.length);
		const result = new Range(this.offset + delta, this.length - delta);
		assert(() => result.offsetEnd === this.offsetEnd);
		return result;
	}

	moveEnd(delta: number): Range {
		return new Range(this.offset, this.length + delta);
	}

	withLength(newLength: number): Range {
		return new Range(this.offset, newLength);
	}

	containsRange(other: Range): boolean {
		/*
		 *     0  1  2  3  4  5
		 *       |#  #  #       this            { offset: 1, end: 3, len: 3 }
		 *    |              |  other: false    { offset: 0, end: -1, len: 0 }
		 *       |  |  |  |     other: true     { offset: i, end: i - 1, len: 0 }
		 *       |# |# |#       other: true
		 *    |#  #    |#  #    other: false
		 *       |#  #  #       other: true
		 */
		// If other is non-empty, this must contain all its points.

		return this.offset <= other.offset && other.offsetEnd <= this.offsetEnd;
	}

	/**
	 * Check whether this range if after `range`.
	 */
	isAfter(range: Range): boolean {
		/*
		 *     0  1  2  3  4  5
		 *       |#  #  #       this
		 *    |  |              other: true
		 *    |#                other: true
		 *       |#             other: false
		 *    |#  #             other: false
		 */
		return range.offsetEnd < this.offset;
	}

	/**
	 * Check whether this range if before `range`.
	 */
	isBefore(range: Range): boolean {
		/*
		 *     0  1  2  3  4  5
		 *       |#  #  #       this
		 *                |  |  other: true
		 *                |#    other: true
		 *             |#       other: false
		 *             |        other: false
		 *             |#  #    other: false
		 */
		return range.offset > this.offsetEnd;
	}
}
