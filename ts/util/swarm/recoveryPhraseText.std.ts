// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the recovery phrase as text - the file that
// "Save to file" writes, and reading the words back out of whatever a person
// pastes into "I have a recovery phrase", including that whole file.
//
// Nothing here checks a phrase: bip39.node.ts does, after this.

/** Lines of a saved file that are not the words start with this. */
const COMMENT_PREFIX = '#';

/**
 * The text of a saved recovery phrase file: one warning line, a blank line,
 * the 24 words on one line in lower case separated by single spaces, and a
 * final newline. Plain text, on purpose: it must open anywhere, in ten years,
 * without this app.
 */
export function recoveryPhraseFileText(
  phrase: string,
  warningLine: string
): string {
  const words = phrase.trim().toLowerCase().split(/\s+/u).join(' ');
  const warning = warningLine.replace(/[\r\n]+/gu, ' ').trim();
  return `${COMMENT_PREFIX} ${warning}\n\n${words}\n`;
}

/**
 * The words in what a person pasted or typed: every line that starts with `#`
 * (the warning line of a saved file) is dropped, and the rest is joined with
 * single spaces. Case and Unicode normalization are left to
 * `normalizePhrase` / `checkRecoveryPhrase`, which the sign-in runs next.
 *
 * So all of these give the same 24 words: the words typed by hand, the words
 * line of a saved file, and the whole saved file with its warning line and its
 * Windows or Unix line endings.
 */
export function recoveryPhraseFromText(text: string): string {
  return text
    .split(/\r\n|\r|\n/u)
    .filter(line => !line.trimStart().startsWith(COMMENT_PREFIX))
    .join(' ')
    .trim()
    .split(/\s+/u)
    .filter(word => word !== '')
    .join(' ');
}

/** How many words a person has typed so far, not counting a file's warning line. */
export function countRecoveryPhraseWords(text: string): number {
  const words = recoveryPhraseFromText(text);
  return words === '' ? 0 : words.split(' ').length;
}
