// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (wallet sign-in): tests for the recovery phrase itself.

import { assert } from 'chai';
import { createHash } from 'node:crypto';

import {
  RECOVERY_PHRASE_WORDS,
  SEED_BYTES,
  checkRecoveryPhrase,
  entropyToPhrase,
  generateRecoveryPhrase,
  normalizePhrase,
  phraseToSeed,
} from '../../util/swarm/bip39.node.ts';
import { BIP39_ENGLISH_WORDLIST } from '../../util/swarm/bip39Wordlist.std.ts';

/**
 * The published SHA-256 of BIP-39's own english.txt: 2048 words, one per line,
 * with a trailing newline. Recomputing it from the array is how we know the
 * vendored list has not been edited, reordered or truncated - which would change
 * every phrase this app has ever produced.
 */
const CANONICAL_WORDLIST_SHA256 =
  '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';

/**
 * BIP-39's own test vectors for 256 bits of entropy (the "english" set in the
 * specification). If these pass, this is BIP-39 and not something that resembles
 * it, and a phrase written down here can be typed into any other BIP-39 wallet.
 */
const ALL_ZERO_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon art';

const ALL_ONES_PHRASE =
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo ' +
  'zoo zoo zoo zoo zoo vote';

const BIP39_VECTORS: ReadonlyArray<readonly [string, string]> = [
  [
    '0000000000000000000000000000000000000000000000000000000000000000',
    ALL_ZERO_PHRASE,
  ],
  [
    '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f',
    'legal winner thank year wave sausage worth useful legal winner thank year ' +
      'wave sausage worth useful legal winner thank year wave sausage worth title',
  ],
  [
    '8080808080808080808080808080808080808080808080808080808080808080',
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage ' +
      'absurd amount doctor acoustic avoid letter advice cage absurd amount ' +
      'doctor acoustic bless',
  ],
  [
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    ALL_ONES_PHRASE,
  ],
];

describe('SWARM wallet sign-in: BIP-39', () => {
  it('carries the wordlist from the specification, unedited', () => {
    assert.strictEqual(BIP39_ENGLISH_WORDLIST.length, 2048);

    const canonicalFile = `${BIP39_ENGLISH_WORDLIST.join('\n')}\n`;
    assert.strictEqual(
      createHash('sha256').update(canonicalFile, 'utf8').digest('hex'),
      CANONICAL_WORDLIST_SHA256,
      'the vendored BIP-39 wordlist no longer matches the published one'
    );

    assert.strictEqual(BIP39_ENGLISH_WORDLIST[0], 'abandon');
    assert.strictEqual(BIP39_ENGLISH_WORDLIST[2047], 'zoo');
    assert.strictEqual(
      new Set(BIP39_ENGLISH_WORDLIST).size,
      2048,
      'the wordlist has a duplicate'
    );
  });

  it("matches BIP-39's own 24-word test vectors", () => {
    for (const [entropyHex, expected] of BIP39_VECTORS) {
      assert.strictEqual(
        entropyToPhrase(Buffer.from(entropyHex, 'hex')),
        expected,
        `entropy ${entropyHex}`
      );
    }
  });

  it('generates 24 valid words', () => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const phrase = generateRecoveryPhrase();

      assert.strictEqual(phrase.split(' ').length, RECOVERY_PHRASE_WORDS);

      const check = checkRecoveryPhrase(phrase);
      assert.isTrue(check.valid, phrase);
    }
  });

  it('generates a different phrase every time', () => {
    const phrases = new Set(
      Array.from({ length: 32 }, () => generateRecoveryPhrase())
    );
    assert.strictEqual(phrases.size, 32);
  });

  it('refuses the wrong number of words', () => {
    const check = checkRecoveryPhrase('abandon abandon abandon');
    assert.isFalse(check.valid);
    assert.deepStrictEqual(check.valid ? undefined : check.problem, {
      type: 'word-count',
      words: 3,
    });
  });

  it('refuses a word that is not in the list', () => {
    const words = ALL_ZERO_PHRASE.split(' ');
    // 'swarm' is in the BIP-39 list; 'swarmcoin' is not.
    words[5] = 'swarmcoin';

    const check = checkRecoveryPhrase(words.join(' '));
    assert.isFalse(check.valid);
    assert.deepStrictEqual(check.valid ? undefined : check.problem, {
      type: 'unknown-word',
      index: 5,
    });
  });

  it('refuses a phrase whose checksum does not agree', () => {
    // Every word is real and the count is right; only the last word is wrong, so
    // nothing but the checksum can catch this.
    const words = ALL_ZERO_PHRASE.split(' ');
    words[23] = 'zoo';

    const check = checkRecoveryPhrase(words.join(' '));
    assert.isFalse(check.valid);
    assert.deepStrictEqual(check.valid ? undefined : check.problem, {
      type: 'checksum',
    });
  });

  it('refuses an empty phrase', () => {
    assert.isFalse(checkRecoveryPhrase('').valid);
    assert.isFalse(checkRecoveryPhrase('   ').valid);
  });

  it('forgives capitals, padding and repeated whitespace', () => {
    const whitespace = '\t \n ';
    const mangled = `  ${ALL_ZERO_PHRASE.toUpperCase()
      .split(' ')
      .join(whitespace)}  `;

    const check = checkRecoveryPhrase(mangled);
    assert.isTrue(check.valid);
    assert.strictEqual(check.valid ? check.phrase : undefined, ALL_ZERO_PHRASE);
    assert.strictEqual(normalizePhrase(mangled), ALL_ZERO_PHRASE);
  });

  it('derives the same 64-byte seed however the phrase was typed', () => {
    const seed = phraseToSeed(ALL_ZERO_PHRASE);
    assert.strictEqual(seed.length, SEED_BYTES);

    assert.deepStrictEqual(
      Buffer.from(
        phraseToSeed(`  ${ALL_ZERO_PHRASE.toUpperCase()}  `)
      ).toString('hex'),
      Buffer.from(seed).toString('hex')
    );

    assert.notStrictEqual(
      Buffer.from(phraseToSeed(ALL_ONES_PHRASE)).toString('hex'),
      Buffer.from(seed).toString('hex')
    );
  });

  it('refuses to make a phrase from the wrong amount of entropy', () => {
    assert.throws(() => entropyToPhrase(new Uint8Array(16)));
    assert.throws(() => entropyToPhrase(new Uint8Array(33)));
  });
});
