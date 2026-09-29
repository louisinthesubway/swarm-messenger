// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (wallet sign-in). One recovery phrase, two things derived from it: the SWARM
// wallet's keys (in the wallet's own code) and this device's Signal identity key pairs (here).
// Restoring the phrase therefore restores the account, on any machine, with no server-side backup
// and nothing to remember but the words.
//
// Everything below is libsignal's own cryptography and nothing else: HKDF-SHA256 from
// @signalapp/libsignal-client to stretch the seed, libsignal's own key types to hold the result, and
// libsignal's XEdDSA to sign the server's challenge. No primitive is implemented here.
//
// The seed and the private keys never leave this process, are never written to a log, and are never
// sent to any server. What goes to the server is a public key and a signature.

import {
  hkdf,
  IdentityKeyPair,
  PrivateKey,
  type PublicKey,
} from '@signalapp/libsignal-client';
import { createHash } from 'node:crypto';

import { phraseToSeed } from './bip39.node.ts';
import {
  SWARM_E164_NATIONAL_DIGITS,
  SWARM_E164_PREFIX,
  isSwarmIdentityE164,
} from './swarmIdentityE164.std.ts';

/**
 * Domain separation for each derived key. Two different labels over the same seed give two
 * independent keys; changing a label orphans every account that was created with it, so these
 * strings are as load-bearing as a database migration and are pinned by the tests.
 */
const ACI_IDENTITY_LABEL = 'SWARM-Messenger-ACI-identity-v1';
const PNI_IDENTITY_LABEL = 'SWARM-Messenger-PNI-identity-v1';

/** Domain separation for the account identifier. Must match the server's SwarmWalletIdentity. */
const E164_LABEL = 'SWARM-Messenger-e164-v1';

/** Domain separation for what we sign to prove we hold the identity key. Must match the server. */
const CHALLENGE_LABEL = 'SWARM-Messenger-wallet-registration-v1';

// SWARM change (B4, 2026-09-29): the prefix and the digit count live in
// swarmIdentityE164.std.ts, so the display code can recognise this identifier
// (and never show it) without importing Node's crypto.
/** ITU-T calling code 888: non-geographic, non-dialable. See the server's SwarmWalletIdentity. */
const E164_PREFIX = SWARM_E164_PREFIX;

/** How many digits follow the prefix. */
const NATIONAL_DIGITS = SWARM_E164_NATIONAL_DIGITS;

/** The smallest 11-digit national number: the derivation never produces a leading zero. */
const NATIONAL_FLOOR = 10n ** BigInt(NATIONAL_DIGITS - 1);

/** How many identifiers exist: 9 * 10^10. */
const NATIONAL_SPACE = 9n * NATIONAL_FLOOR;

/** The length of the server's registration challenge, in bytes. */
export const CHALLENGE_BYTES = 32;

/** A Curve25519 private key scalar, in bytes. */
const PRIVATE_KEY_BYTES = 32;

export type SwarmWalletIdentityType = {
  /** The Signal ACI identity key pair for this account. */
  readonly aciKeyPair: IdentityKeyPair;
  /** The Signal PNI identity key pair for this account. */
  readonly pniKeyPair: IdentityKeyPair;
  /**
   * The synthetic, non-dialable E.164-shaped account identifier the server keys the account by.
   * Never shown to anyone: it exists so that Signal's account model keeps working unchanged.
   */
  readonly accountIdentifier: string;
};

/**
 * The account's identity, derived from its recovery phrase.
 *
 * Deterministic: the same phrase gives the same keys and the same identifier, on this machine and on
 * the next one. That is the entire feature.
 */
export function deriveWalletIdentity(phrase: string): SwarmWalletIdentityType {
  const seed = phraseToSeed(phrase);

  try {
    const aciKeyPair = identityKeyPairFromSeed(seed, ACI_IDENTITY_LABEL);
    const pniKeyPair = identityKeyPairFromSeed(seed, PNI_IDENTITY_LABEL);

    return {
      aciKeyPair,
      pniKeyPair,
      accountIdentifier: accountIdentifierFor(aciKeyPair.publicKey),
    };
  } finally {
    seed.fill(0);
  }
}

/**
 * One identity key pair from the seed and a label.
 *
 * HKDF-SHA256 over the seed, then the standard X25519 clamp - the low three bits and the high bit
 * cleared, the second-highest set - before handing the 32 bytes to libsignal. libsignal clamps the
 * same way internally; doing it here means the bytes we derive and the bytes libsignal serializes
 * back are the same bytes, so nothing depends on where the clamp happened.
 */
export function identityKeyPairFromSeed(
  seed: Uint8Array<ArrayBuffer>,
  label: string
): IdentityKeyPair {
  const derived = Buffer.from(hkdf(PRIVATE_KEY_BYTES, seed, utf8(label), null));

  try {
    const last = PRIVATE_KEY_BYTES - 1;

    // The X25519 clamp, as in RFC 7748: clear the low three bits and the high
    // bit, set the second-highest.
    // oxlint-disable-next-line no-bitwise
    derived.writeUInt8(derived.readUInt8(0) & 0b1111_1000, 0);
    derived.writeUInt8(
      // oxlint-disable-next-line no-bitwise
      (derived.readUInt8(last) & 0b0111_1111) | 0b0100_0000,
      last
    );

    const privateKey = PrivateKey.deserialize(derived);

    return new IdentityKeyPair(privateKey.getPublicKey(), privateKey);
  } finally {
    derived.fill(0);
  }
}

/**
 * The account identifier for an identity public key: `+888` then
 * `10^10 + (the high 8 bytes of SHA-256(label || key) mod 9*10^10)`.
 *
 * The server derives the same string from the same key and refuses a registration where the two
 * disagree, so this function and the server's own `SwarmWalletIdentity` (in the chat server's
 * `swarm` package) must stay byte-for-byte equivalent. Both test suites carry the same vectors to
 * keep them that way.
 */
export function accountIdentifierFor(identityPublicKey: PublicKey): string {
  const serialized = identityPublicKey.serialize();

  const digest = createHash('sha256')
    .update(utf8(E164_LABEL))
    .update(serialized)
    .digest();

  // The high eight bytes, big-endian, unsigned.
  const high = digest.readBigUInt64BE(0);

  return `${E164_PREFIX}${(high % NATIONAL_SPACE) + NATIONAL_FLOOR}`;
}

/** Whether a string is shaped like a SWARM account identifier. Shape only. */
export function isSwarmAccountIdentifier(value: string): boolean {
  // SWARM change (B4, 2026-09-29): one shape rule, in the std file the display
  // code also imports.
  return isSwarmIdentityE164(value);
}

/**
 * What the server wants signed: `"SWARM-Messenger-wallet-registration-v1" || identityKey ||
 * challenge`. The identity key is inside the message so a captured signature cannot be replayed as a
 * signature by some other key.
 */
export function walletChallengeMessage(
  identityPublicKey: PublicKey,
  challenge: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  if (challenge.length !== CHALLENGE_BYTES) {
    throw new Error(
      `walletChallengeMessage: a challenge is ${CHALLENGE_BYTES} bytes, got ${challenge.length}`
    );
  }

  const serialized = identityPublicKey.serialize();
  const label = utf8(CHALLENGE_LABEL);

  const message = new Uint8Array(
    new ArrayBuffer(label.length + serialized.length + challenge.length)
  );
  message.set(label, 0);
  message.set(serialized, label.length);
  message.set(challenge, label.length + serialized.length);

  return message;
}

/** The identity key pair's signature over {@link walletChallengeMessage}. */
export function signWalletChallenge(
  aciKeyPair: IdentityKeyPair,
  challenge: Uint8Array<ArrayBuffer>
): Uint8Array<ArrayBuffer> {
  return aciKeyPair.privateKey.sign(
    walletChallengeMessage(aciKeyPair.publicKey, challenge)
  );
}

/** A label as bytes, in the shape libsignal's typings ask for. */
function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}
