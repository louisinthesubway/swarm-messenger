// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (wallet sign-in). BIP-39: generating a 24-word recovery phrase, checking one a
// person typed, and turning one into the 64-byte seed everything else derives from.
//
// This is BIP-39 as specified and nothing else: SHA-256 for the checksum, PBKDF2-HMAC-SHA512 with
// 2048 iterations and the salt "mnemonic" for the seed. Both come from Node's own crypto. No new
// cryptography is invented here, and nothing in this file is SWARM-specific - the SWARM parts live
// in walletIdentity.node.ts.
//
// The phrase is the account and the money. Nothing in this file logs, stores or transmits one.

import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';

import {
  BIP39_ENGLISH_WORDLIST,
  RECOVERY_PHRASE_WORDS,
} from './bip39Wordlist.std.ts';

export { RECOVERY_PHRASE_WORDS };

/** The entropy behind a 24-word phrase, in bytes. */
const ENTROPY_BYTES = 32;

/** BIP-39's own salt prefix for the seed derivation. */
const SEED_SALT_PREFIX = 'mnemonic';

/** BIP-39's iteration count. Fixed by the specification. */
const SEED_ITERATIONS = 2048;

/** The seed BIP-39 produces, in bytes. */
export const SEED_BYTES = 64;

const WORD_INDEX: ReadonlyMap<string, number> = new Map(
  BIP39_ENGLISH_WORDLIST.map((word, index) => [word, index])
);

/** Why a phrase was refused. The UI turns this into a sentence; it is not a log line. */
export type PhraseProblem =
  | { type: 'word-count'; words: number }
  | { type: 'unknown-word'; index: number }
  | { type: 'checksum' };

export type PhraseCheck =
  | { valid: true; phrase: string }
  | { valid: false; problem: PhraseProblem };

/**
 * A phrase as BIP-39 wants it compared: Unicode NFKD, lower case, single spaces, no padding.
 *
 * Normalizing before hashing is what makes "the same phrase" mean the same thing on Windows, macOS
 * and Android, whatever the keyboard did with the whitespace.
 */
export function normalizePhrase(phrase: string): string {
  return phrase.normalize('NFKD').toLowerCase().trim().split(/\s+/u).join(' ');
}

/**
 * A new 24-word recovery phrase from the system's own randomness.
 *
 * The caller shows it once, for the person to write down, and then hands it to
 * {@link phraseToSeed} and forgets it.
 */
export function generateRecoveryPhrase(): string {
  return entropyToPhrase(randomBytes(ENTROPY_BYTES));
}

/** The phrase for a given 32 bytes of entropy. Exported for the test vectors. */
export function entropyToPhrase(entropy: Uint8Array<ArrayBuffer>): string {
  if (entropy.length !== ENTROPY_BYTES) {
    throw new Error(
      `entropyToPhrase: a 24-word phrase needs ${ENTROPY_BYTES} bytes of entropy`
    );
  }

  // BIP-39: the checksum is the first (entropy bits / 32) bits of SHA-256(entropy). For 256 bits of
  // entropy that is 8 bits, giving 264 bits = 24 groups of 11.
  const checksum = createHash('sha256').update(entropy).digest();
  const bits = `${toBitString(entropy)}${toBitString(checksum).slice(0, ENTROPY_BYTES / 4)}`;

  const words: Array<string> = [];
  for (let offset = 0; offset < bits.length; offset += 11) {
    const index = parseInt(bits.slice(offset, offset + 11), 2);
    const word = BIP39_ENGLISH_WORDLIST[index];
    if (word == null) {
      throw new Error('entropyToPhrase: the wordlist is the wrong length');
    }
    words.push(word);
  }

  return words.join(' ');
}

/**
 * Whether a phrase is a real BIP-39 phrase: the right number of known words, with a checksum that
 * agrees. A typo in one word fails the checksum with probability 255/256, which is the whole reason
 * BIP-39 has one.
 */
export function checkRecoveryPhrase(phrase: string): PhraseCheck {
  const normalized = normalizePhrase(phrase);
  const words = normalized === '' ? [] : normalized.split(' ');

  if (words.length !== RECOVERY_PHRASE_WORDS) {
    return {
      valid: false,
      problem: { type: 'word-count', words: words.length },
    };
  }

  let bits = '';
  for (const [index, word] of words.entries()) {
    const wordIndex = WORD_INDEX.get(word);
    if (wordIndex === undefined) {
      return { valid: false, problem: { type: 'unknown-word', index } };
    }
    bits += wordIndex.toString(2).padStart(11, '0');
  }

  const entropyBits = bits.slice(0, ENTROPY_BYTES * 8);
  const checksumBits = bits.slice(ENTROPY_BYTES * 8);

  const entropy = new Uint8Array(ENTROPY_BYTES);
  for (let index = 0; index < ENTROPY_BYTES; index += 1) {
    entropy[index] = parseInt(entropyBits.slice(index * 8, index * 8 + 8), 2);
  }

  const expected = toBitString(
    createHash('sha256').update(entropy).digest()
  ).slice(0, checksumBits.length);

  if (expected !== checksumBits) {
    return { valid: false, problem: { type: 'checksum' } };
  }

  return { valid: true, phrase: normalized };
}

/**
 * The 64-byte BIP-39 seed for a phrase, with the empty passphrase.
 *
 * This is the same seed the SWARM wallet derives its spending keys from, which is what "one recovery
 * phrase for the money and the identity" means in practice.
 */
export function phraseToSeed(phrase: string): Uint8Array<ArrayBuffer> {
  const normalized = normalizePhrase(phrase);

  return new Uint8Array(
    pbkdf2Sync(
      Buffer.from(normalized.normalize('NFKD'), 'utf8'),
      Buffer.from(SEED_SALT_PREFIX.normalize('NFKD'), 'utf8'),
      SEED_ITERATIONS,
      SEED_BYTES,
      'sha512'
    )
  );
}

function toBitString(bytes: Uint8Array<ArrayBuffer>): string {
  let bits = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  return bits;
}
