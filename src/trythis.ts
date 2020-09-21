// Match everything after "Try this" until the next unindented line
export const magicWord = 'Try this:';
export const regex = '^' + magicWord + '((.*\n )*.*)$';
export const regexGM = new RegExp(regex, 'gm');
export const regexM = new RegExp(regex, 'm');
