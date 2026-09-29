// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (wallet sign-in): tests for the derivation that ties a SWARM
// account to a wallet recovery phrase, and for the challenge it signs.
//
// The three vectors below are the contract with the server. The identical values
// appear in the server's own `SwarmWalletIdentityTest`, in the chat server repo.
// If either side changes, both tests fail, which is the point: a silent change
// would make every account that already exists unreachable.

import { assert } from 'chai';
import { createHash } from 'node:crypto';

import { entropyToPhrase } from '../../util/swarm/bip39.node.ts';
import {
  CHALLENGE_BYTES,
  accountIdentifierFor,
  deriveWalletIdentity,
  isSwarmAccountIdentifier,
  signWalletChallenge,
  walletChallengeMessage,
} from '../../util/swarm/walletIdentity.node.ts';
import { isSwarmIdentityE164 } from '../../util/swarm/swarmIdentityE164.std.ts';

type Vector = {
  readonly name: string;
  readonly entropyHex: string;
  readonly aciPublicKey: string;
  readonly pniPublicKey: string;
  readonly accountIdentifier: string;
};

const ALL_ZERO_VECTOR: Vector = {
  name: 'all-zero entropy',
  entropyHex:
    '0000000000000000000000000000000000000000000000000000000000000000',
  aciPublicKey: 'BdUup/KTUWFdGc1rkQy8qqoAXARjDuW2b32p1STJMl5Y',
  pniPublicKey: 'Bb/DNv+zf1/4omFOsikRqikH98rBEEbzHpAnRWjNlGAe',
  accountIdentifier: '+88810866442360',
};

const COUNTING_VECTOR: Vector = {
  name: 'counting entropy',
  entropyHex:
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  aciPublicKey: 'BUOazbfLOeK5YwjvL8ASlC5sCw/d+FZZ+q6SUesG1kJw',
  pniPublicKey: 'BVg+L0CFHf5JJmbswnfeloNIC8Tr1UDsOg9fKfqBukZj',
  accountIdentifier: '+88844571413476',
};

const ALL_ONES_VECTOR: Vector = {
  name: 'all-ones entropy',
  entropyHex:
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  aciPublicKey: 'BQ6Pzj4KiojM/8GeHWZRfKPSaPVN6SDYaala/FDHmvUL',
  pniPublicKey: 'BdmZayL61kzx0DrCVNQcAkzN7pxBLroSZtuMLAfjPJ8V',
  accountIdentifier: '+88834279664637',
};

const VECTORS: ReadonlyArray<Vector> = [
  ALL_ZERO_VECTOR,
  COUNTING_VECTOR,
  ALL_ONES_VECTOR,
];

function phraseFor(vector: Vector): string {
  return entropyToPhrase(Buffer.from(vector.entropyHex, 'hex'));
}

describe('SWARM wallet sign-in: identity derivation', () => {
  it('derives the keys and identifier the server expects', () => {
    for (const vector of VECTORS) {
      const { aciKeyPair, pniKeyPair, accountIdentifier } =
        deriveWalletIdentity(phraseFor(vector));

      assert.strictEqual(
        Buffer.from(aciKeyPair.publicKey.serialize()).toString('base64'),
        vector.aciPublicKey,
        `${vector.name}: ACI identity key`
      );
      assert.strictEqual(
        Buffer.from(pniKeyPair.publicKey.serialize()).toString('base64'),
        vector.pniPublicKey,
        `${vector.name}: PNI identity key`
      );
      assert.strictEqual(
        accountIdentifier,
        vector.accountIdentifier,
        `${vector.name}: account identifier`
      );
    }
  });

  it('gives the same answer however the phrase was typed', () => {
    const vector = ALL_ZERO_VECTOR;
    const phrase = phraseFor(vector);

    const typed = deriveWalletIdentity(`  ${phrase.toUpperCase()}  `);

    assert.strictEqual(typed.accountIdentifier, vector.accountIdentifier);
    assert.strictEqual(
      Buffer.from(typed.aciKeyPair.publicKey.serialize()).toString('base64'),
      vector.aciPublicKey
    );
  });

  it('gives different keys for the ACI and the PNI', () => {
    for (const vector of VECTORS) {
      assert.notStrictEqual(vector.aciPublicKey, vector.pniPublicKey);
    }
  });

  it('gives different accounts for different phrases', () => {
    const identifiers = new Set(
      VECTORS.map(
        vector => deriveWalletIdentity(phraseFor(vector)).accountIdentifier
      )
    );
    assert.strictEqual(identifiers.size, VECTORS.length);
  });

  it('serializes the private key it derived, unchanged by the clamp', () => {
    // libsignal clamps a private key when it deserializes one. We clamp first, so
    // what we hand it and what it hands back must be the same 32 bytes - if they
    // were not, the key stored in the protocol store would not be the key the
    // identifier was derived from.
    const vector = ALL_ZERO_VECTOR;
    const { aciKeyPair } = deriveWalletIdentity(phraseFor(vector));

    const serialized = Buffer.from(aciKeyPair.privateKey.serialize());
    assert.strictEqual(serialized.length, 32);
    // oxlint-disable-next-line no-bitwise
    assert.strictEqual(serialized.readUInt8(0) & 0b111, 0);
    // oxlint-disable-next-line no-bitwise
    assert.strictEqual(serialized.readUInt8(31) & 0b1100_0000, 0b0100_0000);
  });

  it('derives an identifier that is shaped like one', () => {
    for (const vector of VECTORS) {
      assert.isTrue(isSwarmAccountIdentifier(vector.accountIdentifier));
      assert.strictEqual(vector.accountIdentifier.length, '+888'.length + 11);
    }
  });

  // SWARM addition (B4, 2026-09-29): the display code's shape check (a std
  // file, no Node crypto) agrees with the derivation, so every derived
  // identifier is one the interface hides.
  it('derives identifiers the interface recognises and hides', () => {
    for (const vector of VECTORS) {
      const { accountIdentifier } = deriveWalletIdentity(phraseFor(vector));
      assert.isTrue(isSwarmIdentityE164(accountIdentifier), vector.name);
    }
  });

  it('does not mistake anything else for an identifier', () => {
    for (const value of [
      '+14155550123',
      '+8881854292138',
      '+888185429213820',
      '+88808542921382',
      '+8881854292138a',
      '888185429213820',
      '+889185429213820',
      '',
    ]) {
      assert.isFalse(isSwarmAccountIdentifier(value), value);
    }
  });

  it('derives the identifier the documented way', () => {
    const vector = ALL_ZERO_VECTOR;
    const { aciKeyPair } = deriveWalletIdentity(phraseFor(vector));

    const digest = createHash('sha256')
      .update(Buffer.from('SWARM-Messenger-e164-v1', 'utf8'))
      .update(aciKeyPair.publicKey.serialize())
      .digest();

    const high = digest.readBigUInt64BE(0);

    assert.strictEqual(
      accountIdentifierFor(aciKeyPair.publicKey),
      `+888${(high % (9n * 10n ** 10n)) + 10n ** 10n}`
    );
  });
});

describe('SWARM wallet sign-in: the challenge', () => {
  const challenge = new Uint8Array(CHALLENGE_BYTES).fill(0x11);

  it('signs the message the server verifies', () => {
    const vector = ALL_ZERO_VECTOR;
    const { aciKeyPair } = deriveWalletIdentity(phraseFor(vector));

    const signature = signWalletChallenge(aciKeyPair, challenge);

    assert.isTrue(
      aciKeyPair.publicKey.verify(
        walletChallengeMessage(aciKeyPair.publicKey, challenge),
        signature
      )
    );
  });

  it('builds the message from the label, the key and the challenge', () => {
    const vector = ALL_ZERO_VECTOR;
    const { aciKeyPair } = deriveWalletIdentity(phraseFor(vector));

    const label = Buffer.from('SWARM-Messenger-wallet-registration-v1', 'utf8');
    const expected = Buffer.concat([
      label,
      Buffer.from(aciKeyPair.publicKey.serialize()),
      Buffer.from(challenge),
    ]);

    assert.strictEqual(
      Buffer.from(
        walletChallengeMessage(aciKeyPair.publicKey, challenge)
      ).toString('base64'),
      expected.toString('base64')
    );
  });

  it('will not sign a challenge of the wrong length', () => {
    const vector = ALL_ZERO_VECTOR;
    const { aciKeyPair } = deriveWalletIdentity(phraseFor(vector));

    assert.throws(() =>
      signWalletChallenge(aciKeyPair, new Uint8Array(CHALLENGE_BYTES - 1))
    );
    assert.throws(() => signWalletChallenge(aciKeyPair, new Uint8Array(0)));
  });

  it('does not answer a different challenge', () => {
    const vector = ALL_ZERO_VECTOR;
    const { aciKeyPair } = deriveWalletIdentity(phraseFor(vector));

    const signature = signWalletChallenge(aciKeyPair, challenge);
    const other = new Uint8Array(CHALLENGE_BYTES).fill(0x12);

    assert.isFalse(
      aciKeyPair.publicKey.verify(
        walletChallengeMessage(aciKeyPair.publicKey, other),
        signature
      )
    );
  });

  it('does not answer for a different key', () => {
    const victim = deriveWalletIdentity(phraseFor(ALL_ZERO_VECTOR)).aciKeyPair;
    const attacker = deriveWalletIdentity(
      phraseFor(COUNTING_VECTOR)
    ).aciKeyPair;

    // The attacker signs the message that names the victim's key.
    const forged = attacker.privateKey.sign(
      walletChallengeMessage(victim.publicKey, challenge)
    );

    assert.isFalse(
      victim.publicKey.verify(
        walletChallengeMessage(victim.publicKey, challenge),
        forged
      )
    );
  });
});
