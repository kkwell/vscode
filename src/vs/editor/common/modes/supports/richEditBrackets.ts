/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import { Range } from 'vs/editor/common/core/range';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { CharacterPair } from 'vs/editor/common/modes/languageConfiguration';

interface ISimpleInternalBracket {
	open: string;
	close: string;
}

export class RichEditBracket {
	_richEditBracketBrand: void;

	readonly languageIdentifier: LanguageIdentifier;
	readonly open: string;
	readonly close: string;
	readonly forwardRegex: RegExp;
	readonly reversedRegex: RegExp;

	constructor(languageIdentifier: LanguageIdentifier, open: string, close: string, forwardRegex: RegExp, reversedRegex: RegExp) {
		this.languageIdentifier = languageIdentifier;
		this.open = open;
		this.close = close;
		this.forwardRegex = forwardRegex;
		this.reversedRegex = reversedRegex;
	}
}

export class RichEditBrackets {
	_richEditBracketsBrand: void;

	public readonly brackets: RichEditBracket[];
	public readonly forwardRegex: RegExp;
	public readonly reversedRegex: RegExp;
	public readonly maxBracketLength: number;
	public readonly textIsBracket: { [text: string]: RichEditBracket; };
	public readonly textIsOpenBracket: { [text: string]: boolean; };

	constructor(languageIdentifier: LanguageIdentifier, brackets: CharacterPair[]) {
		brackets = brackets.map(b => [b[0].toLowerCase(), b[1].toLowerCase()]);
		this.brackets = brackets.map((b, index) => {
			return new RichEditBracket(
				languageIdentifier,
				b[0],
				b[1],
				getRegexForBracketPair(b[0], b[1], brackets, index),
				getReversedRegexForBracketPair(b[0], b[1], brackets, index)
			);
		});
		this.forwardRegex = getRegexForBrackets(this.brackets);
		this.reversedRegex = getReversedRegexForBrackets(this.brackets);

		this.textIsBracket = {};
		this.textIsOpenBracket = {};

		let maxBracketLength = 0;
		this.brackets.forEach((b) => {
			this.textIsBracket[b.open] = b;
			this.textIsBracket[b.close] = b;
			this.textIsOpenBracket[b.open] = true;
			this.textIsOpenBracket[b.close] = false;
			maxBracketLength = Math.max(maxBracketLength, b.open.length);
			maxBracketLength = Math.max(maxBracketLength, b.close.length);
		});
		this.maxBracketLength = maxBracketLength;
	}
}

function once<T, R>(keyFn: (input: T) => string, computeFn: (input: T) => R): (input: T) => R {
	let cache: { [key: string]: R; } = {};
	return (input: T): R => {
		let key = keyFn(input);
		if (!cache.hasOwnProperty(key)) {
			cache[key] = computeFn(input);
		}
		return cache[key];
	};
}

function collectSuperstrings(str: string, brackets: CharacterPair[], currentIndex: number, dest: string[]): void {
	for (let i = 0, len = brackets.length; i < len; i++) {
		if (i === currentIndex) {
			continue;
		}
		const [open, close] = brackets[i];
		if (open.indexOf(str) >= 0) {
			dest.push(open);
		}
		if (close.indexOf(str) >= 0) {
			dest.push(close);
		}
	}
}

function lengthcmp(a: string, b: string) {
	return a.length - b.length;
}

function getRegexForBracketPair(open: string, close: string, brackets: CharacterPair[], currentIndex: number): RegExp {
	// search in all brackets for other brackets that are a superstring of these brackets
	const pieces: string[] = [open, close];
	collectSuperstrings(open, brackets, currentIndex, pieces);
	collectSuperstrings(close, brackets, currentIndex, pieces);
	pieces.sort(lengthcmp);
	pieces.reverse();
	return createBracketOrRegExp(pieces);
}

function getReversedRegexForBracketPair(open: string, close: string, brackets: CharacterPair[], currentIndex: number): RegExp {
	// search in all brackets for other brackets that are a superstring of these brackets
	const pieces: string[] = [open, close];
	collectSuperstrings(open, brackets, currentIndex, pieces);
	collectSuperstrings(close, brackets, currentIndex, pieces);
	pieces.sort(lengthcmp);
	pieces.reverse();
	return createBracketOrRegExp(pieces.map(toReversedString));
}

const getRegexForBrackets = once<ISimpleInternalBracket[], RegExp>(
	(input) => input.map(b => `${b.open};${b.close}`).join(';'),
	(input) => {
		let pieces: string[] = [];
		input.forEach((b) => {
			pieces.push(b.open);
			pieces.push(b.close);
		});
		return createBracketOrRegExp(pieces);
	}
);

const getReversedRegexForBrackets = once<ISimpleInternalBracket[], RegExp>(
	(input) => input.map(b => `${b.open};${b.close}`).join(';'),
	(input) => {
		let pieces: string[] = [];
		input.forEach((b) => {
			pieces.push(toReversedString(b.open));
			pieces.push(toReversedString(b.close));
		});
		return createBracketOrRegExp(pieces);
	}
);

function prepareBracketForRegExp(str: string): string {
	// This bracket pair uses letters like e.g. "begin" - "end"
	const insertWordBoundaries = (/^[\w ]+$/.test(str));
	str = strings.escapeRegExpCharacters(str);
	return (insertWordBoundaries ? `\\b${str}\\b` : str);
}

function createBracketOrRegExp(pieces: string[]): RegExp {
	let regexStr = `(${pieces.map(prepareBracketForRegExp).join(')|(')})`;
	return strings.createRegExp(regexStr, true);
}

let toReversedString = (function () {

	function reverse(str: string): string {
		let reversedStr = '';
		for (let i = str.length - 1; i >= 0; i--) {
			reversedStr += str.charAt(i);
		}
		return reversedStr;
	}

	let lastInput: string | null = null;
	let lastOutput: string | null = null;
	return function toReversedString(str: string): string {
		if (lastInput !== str) {
			lastInput = str;
			lastOutput = reverse(lastInput);
		}
		return lastOutput!;
	};
})();

export class BracketsUtils {

	private static _findPrevBracketInText(reversedBracketRegex: RegExp, lineNumber: number, reversedText: string, offset: number): Range | null {
		let m = reversedText.match(reversedBracketRegex);

		if (!m) {
			return null;
		}

		let matchOffset = reversedText.length - (m.index || 0);
		let matchLength = m[0].length;
		let absoluteMatchOffset = offset + matchOffset;

		return new Range(lineNumber, absoluteMatchOffset - matchLength + 1, lineNumber, absoluteMatchOffset + 1);
	}

	public static findPrevBracketInRange(reversedBracketRegex: RegExp, lineNumber: number, lineText: string, startOffset: number, endOffset: number): Range | null {
		// Because JS does not support backwards regex search, we search forwards in a reversed string with a reversed regex ;)
		const reversedLineText = toReversedString(lineText);
		const reversedSubstr = reversedLineText.substring(lineText.length - endOffset, lineText.length - startOffset);
		return this._findPrevBracketInText(reversedBracketRegex, lineNumber, reversedSubstr, startOffset);
	}

	public static findNextBracketInText(bracketRegex: RegExp, lineNumber: number, text: string, offset: number): Range | null {
		let m = text.match(bracketRegex);

		if (!m) {
			return null;
		}

		let matchOffset = m.index || 0;
		let matchLength = m[0].length;
		if (matchLength === 0) {
			return null;
		}
		let absoluteMatchOffset = offset + matchOffset;

		return new Range(lineNumber, absoluteMatchOffset + 1, lineNumber, absoluteMatchOffset + 1 + matchLength);
	}

	public static findNextBracketInRange(bracketRegex: RegExp, lineNumber: number, lineText: string, startOffset: number, endOffset: number): Range | null {
		const substr = lineText.substring(startOffset, endOffset);
		return this.findNextBracketInText(bracketRegex, lineNumber, substr, startOffset);
	}
}
