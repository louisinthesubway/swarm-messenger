// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): recovery phrase export, end to end as far
// as it runs without a window.
//
//   a throwaway phrase → its identity → a wallet restored from it in a temp
//   directory (the real wallet store and wrapper, a fake addon) → closed and
//   opened again → 'seed-phrase' → the same normalized words → the same
//   identity; and the file "Save to file" writes, read back the way
//   "I have a recovery phrase" reads what is pasted, signs in as the same
//   account.
//
// No phrase in this file is anyone's: every one is generated here or is a
// published test vector.

import { assert } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { SwarmWallet } from 'swarm-wallet-core';

import {
  checkRecoveryPhrase,
  entropyToPhrase,
  generateRecoveryPhrase,
  normalizePhrase,
} from '../../util/swarm/bip39.node.ts';
import { deriveWalletIdentity } from '../../util/swarm/walletIdentity.node.ts';
import {
  SwarmWalletHandler,
  toWorkerError,
} from '../../workers/swarmWalletHandler.node.ts';
import type { WalletLocationType } from '../../workers/swarmWalletProtocol.std.ts';
import { createFakeSwarmWalletAddon } from '../../test-helpers/fakeSwarmWalletAddon.node.ts';
import {
  countRecoveryPhraseWords,
  recoveryPhraseFileText,
  recoveryPhraseFromText,
} from '../../util/swarm/recoveryPhraseText.std.ts';
import {
  accountKeyForPhrase,
  redactForLog,
} from '../../util/swarm/walletIpc.node.ts';

const WARNING =
  'SWARM Messenger recovery phrase. This file is NOT encrypted: anyone who reads these 24 words owns the account and the money in its wallet.';

function sameIdentity(a: string, b: string): void {
  const left = deriveWalletIdentity(a);
  const right = deriveWalletIdentity(b);
  assert.deepEqual(
    left.aciKeyPair.publicKey.serialize(),
    right.aciKeyPair.publicKey.serialize()
  );
  assert.deepEqual(
    left.pniKeyPair.publicKey.serialize(),
    right.pniKeyPair.publicKey.serialize()
  );
  assert.strictEqual(left.accountIdentifier, right.accountIdentifier);
}

describe('SWARM recovery phrase export (B6)', () => {
  describe('the wallet worker gives back the words it was restored from', () => {
    let dataDir: string;
    let key: Uint8Array<ArrayBuffer>;
    let fake: ReturnType<typeof createFakeSwarmWalletAddon>;
    let handler: SwarmWalletHandler;

    const location = (): WalletLocationType => ({
      dataDir,
      walletName: 'wallet-00112233445566778899aabbccddeeff.dat',
      chain: 'swarm-mainnet',
      server: 'https://lwd-main.swarm.green:443',
      encryptionKey: new Uint8Array(key),
    });

    beforeEach(async () => {
      dataDir = await mkdtemp(join(tmpdir(), 'swarm-recovery-export-'));
      key = new Uint8Array(randomBytes(32));
      fake = createFakeSwarmWalletAddon();
      handler = new SwarmWalletHandler({ loadAddon: () => fake.addon });
    });

    afterEach(async () => {
      await handler.handle({ kind: 'close' });
      await SwarmWallet.current()?.close();
      await rm(dataDir, { recursive: true, force: true });
    });

    it('round trip: phrase → identity → wallet → closed, reopened → the same words → the same identity', async () => {
      // (a) a throwaway phrase, (b) the identity it signs in as
      const phrase = generateRecoveryPhrase();
      const identity = deriveWalletIdentity(phrase);

      // (c) a wallet restored from it, offline, in a temp directory
      assert.deepStrictEqual(
        await handler.handle({
          kind: 'restore',
          location: location(),
          phrase,
          birthdayHeight: 1,
        }),
        { restarted: false }
      );
      await handler.handle({ kind: 'close' });

      // A new worker, as after a restart: the wallet is opened from its
      // sealed file, not restored again.
      fake = createFakeSwarmWalletAddon();
      handler = new SwarmWalletHandler({ loadAddon: () => fake.addon });
      assert.deepStrictEqual(
        await handler.handle({ kind: 'open', location: location() }),
        { restarted: false }
      );
      assert.deepStrictEqual(fake.log.seedsGiven, []);

      // (d) 'seed-phrase' answers the same normalized words, as UTF-8 bytes
      const answered = await handler.handle({ kind: 'seed-phrase' });
      if (!(answered instanceof Uint8Array)) {
        throw new Error('seed-phrase did not answer bytes');
      }
      // A buffer of its own, so the worker can transfer it and keep nothing.
      assert.strictEqual(answered.byteOffset, 0);
      assert.strictEqual(answered.byteLength, answered.buffer.byteLength);
      const words = new TextDecoder().decode(answered);
      assert.strictEqual(words, normalizePhrase(phrase));
      assert.strictEqual(words.split(' ').length, 24);

      const again = deriveWalletIdentity(words);
      assert.deepEqual(
        again.aciKeyPair.publicKey.serialize(),
        identity.aciKeyPair.publicKey.serialize()
      );
      assert.strictEqual(again.accountIdentifier, identity.accountIdentifier);
    });

    it('answers the words normalized: lower case, single spaces', async () => {
      const phrase = entropyToPhrase(
        new Uint8Array(Array.from({ length: 32 }, (_, i) => i))
      );
      const messy = `  ${phrase.toUpperCase().split(' ').join('   ')}\n`;
      await handler.handle({
        kind: 'restore',
        location: location(),
        phrase: messy,
        birthdayHeight: 1,
      });
      const bytes = (await handler.handle({
        kind: 'seed-phrase',
      })) as Uint8Array<ArrayBuffer>;
      assert.strictEqual(new TextDecoder().decode(bytes), phrase);
    });

    it('refuses when no wallet is open', async () => {
      let caught: unknown;
      try {
        await handler.handle({ kind: 'seed-phrase' });
      } catch (error) {
        caught = error;
      }
      assert.strictEqual(toWorkerError(caught).code, 'not-open');
    });

    it('refuses, without quoting them, words that are not a valid phrase', async () => {
      const notAPhrase = Array.from({ length: 24 }, () => 'zoo').join(' ');
      await handler.handle({
        kind: 'restore',
        location: location(),
        phrase: notAPhrase,
        birthdayHeight: 1,
      });
      let caught: unknown;
      try {
        await handler.handle({ kind: 'seed-phrase' });
      } catch (error) {
        caught = error;
      }
      const { code, message } = toWorkerError(caught);
      assert.strictEqual(code, 'malformed-response');
      assert.notInclude(message, 'zoo');
    });
  });

  describe('what "Save to file" writes, signed in with again', () => {
    const phrase = generateRecoveryPhrase();
    const file = recoveryPhraseFileText(phrase, WARNING);

    it('is one warning line, a blank line, the words on one line, a newline', () => {
      const lines = file.split('\n');
      assert.strictEqual(lines.length, 4);
      assert.match(lines[0] ?? '', /^# .*NOT encrypted/);
      assert.strictEqual(lines[1], '');
      assert.strictEqual(lines[2], phrase);
      assert.strictEqual(lines[3], '');
    });

    const pastes: ReadonlyArray<[string, string]> = [
      ['the whole file', file],
      ['the whole file with Windows line endings', file.replace(/\n/g, '\r\n')],
      ['the words line with its newline', `${phrase}\n`],
      [
        'the words in upper case with extra spaces',
        ` ${phrase.toUpperCase().replace(/ /g, '  ')} `,
      ],
      ['the words one per line', phrase.split(' ').join('\n')],
    ];
    for (const [name, pasted] of pastes) {
      it(`signs in as the same account from ${name}`, () => {
        assert.strictEqual(countRecoveryPhraseWords(pasted), 24);
        const check = checkRecoveryPhrase(recoveryPhraseFromText(pasted));
        assert.isTrue(check.valid);
        assert.strictEqual(check.valid && check.phrase, phrase);
        sameIdentity(check.valid ? check.phrase : '', phrase);
        assert.deepEqual(
          accountKeyForPhrase(recoveryPhraseFromText(pasted)),
          accountKeyForPhrase(phrase)
        );
      });
    }

    it('does not count the warning line as words', () => {
      assert.strictEqual(countRecoveryPhraseWords(''), 0);
      assert.strictEqual(countRecoveryPhraseWords(`# ${WARNING}\n\n`), 0);
      assert.strictEqual(
        countRecoveryPhraseWords(
          `# ${WARNING}\n${phrase.split(' ').slice(0, 12).join(' ')}`
        ),
        12
      );
    });
  });

  describe('the log never keeps a phrase', () => {
    it('replaces a phrase quoted in a failure message', () => {
      const phrase = generateRecoveryPhrase();
      const redacted = redactForLog(`init_from_seed failed for "${phrase}"`);
      assert.strictEqual(redacted, 'init_from_seed failed for "<words>"');
      assert.strictEqual(
        redactForLog(`seed was ${phrase.split(' ').slice(0, 6).join(', ')}`),
        'seed was <words>'
      );
    });

    it('leaves ordinary sentences alone', () => {
      const text = 'the light server did not answer; the wallet is open';
      assert.strictEqual(redactForLog(text), text);
    });
  });
});
