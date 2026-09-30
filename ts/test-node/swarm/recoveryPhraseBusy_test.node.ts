// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (0.1.3, 2026-09-30): the recovery phrase read waits for a busy
// wallet instead of giving up after fifteen seconds.
//
// In 0.1.2 the owner asked for the words right after the wallet opened, while
// its first sync ran and the light server was slow, and was told "The words
// could not be read from your wallet": the read had simply waited longer than
// the fifteen seconds every quick call gets. Driven here with the real worker
// handler and wallet wrapper and a fake addon whose `get_seed` takes as long as
// the test says, and with the limits scaled down so the test runs in a second:
//
//  - a busy wallet (a sync running) is waited for past the old limit, and the
//    window is told it is busy; the words arrive intact;
//  - a wallet that stays busy for the whole wait is 'busy', not 'failed';
//  - a real failure is still a failure, at once, and a slow wallet that is NOT
//    busy still fails at the old limit;
//  - bytes that arrive after the read gave up are zeroed;
//  - nothing is written to the console, and no failure quotes the words.
//
// No phrase in this file is anyone's: each is generated here.

import { assert } from 'chai';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { SwarmWallet } from 'swarm-wallet-core';

import {
  generateRecoveryPhrase,
  normalizePhrase,
} from '../../util/swarm/bip39.node.ts';
import {
  RECOVERY_PHRASE_READ_LIMITS,
  waitForRecoveryPhrase,
} from '../../util/swarm/recoveryPhraseRead.std.ts';
import type { RecoveryPhraseReadLimitsType } from '../../util/swarm/recoveryPhraseRead.std.ts';
import {
  SwarmWalletHandler,
  toWorkerError,
} from '../../workers/swarmWalletHandler.node.ts';
import {
  codeOf,
  codedError,
  messageOf,
} from '../../workers/swarmWalletProtocol.std.ts';
import type {
  WalletLocationType,
  WalletSnapshotType,
  WorkerRequestType,
} from '../../workers/swarmWalletProtocol.std.ts';
import { drop } from '../../util/drop.std.ts';
import { createFakeSwarmWalletAddon } from '../../test-helpers/fakeSwarmWalletAddon.node.ts';
import type { FakeAddonOptionsType } from '../../test-helpers/fakeSwarmWalletAddon.node.ts';

/** The real limits, scaled down: 15 s → 100 ms, 3 min → 400 ms. */
const LIMITS: RecoveryPhraseReadLimitsType = {
  quickMs: 100,
  busyNoticeMs: 20,
  busyWaitMs: 400,
};

const ROOT = join(import.meta.dirname, '..', '..', '..');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('SWARM recovery phrase: the limits (0.1.3)', () => {
  it('keeps the old limit of 15 s for a wallet that is not busy, and waits up to 3 minutes for one that is', () => {
    assert.strictEqual(RECOVERY_PHRASE_READ_LIMITS.quickMs, 15_000);
    assert.strictEqual(RECOVERY_PHRASE_READ_LIMITS.busyWaitMs, 3 * 60_000);
    assert.isBelow(
      RECOVERY_PHRASE_READ_LIMITS.busyNoticeMs,
      RECOVERY_PHRASE_READ_LIMITS.quickMs
    );
  });
});

describe('SWARM recovery phrase: waiting for a busy wallet (0.1.3)', () => {
  let dataDir: string;
  let handler: SwarmWalletHandler;
  let phrase: string;

  const location = (): WalletLocationType => ({
    dataDir,
    walletName: 'wallet-00112233445566778899aabbccddeeff.dat',
    chain: 'swarm-mainnet',
    server: 'https://lwd-main.swarm.green:8443',
    encryptionKey: new Uint8Array(randomBytes(32)),
  });

  /**
   * As SwarmWalletService's `#call`: the answer, or 'timeout' after `ms`; an
   * answer that comes after the timeout is zeroed, as the service's reply
   * handler does, and kept in `lateAnswers` for the test to look at.
   */
  let lateAnswers: Array<unknown>;
  const call = (request: WorkerRequestType, ms: number): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(codedError('timeout', `${request.kind} took too long`));
      }, ms);
      drop(
        (async () => {
          let value: unknown;
          try {
            value = await handler.handle(request);
          } catch (error) {
            clearTimeout(timer);
            const { code, message } = toWorkerError(error);
            reject(codedError(code, message));
            return;
          }
          if (timedOut) {
            if (value instanceof Uint8Array) {
              value.fill(0);
            }
            lateAnswers.push(value);
            return;
          }
          clearTimeout(timer);
          resolve(value);
        })()
      );
    });

  async function openWallet(options: FakeAddonOptionsType): Promise<void> {
    const fake = createFakeSwarmWalletAddon(options);
    handler = new SwarmWalletHandler({ loadAddon: () => fake.addon });
    phrase = generateRecoveryPhrase();
    await handler.handle({
      kind: 'restore',
      location: location(),
      phrase,
      birthdayHeight: 1,
    });
  }

  /** Starts a sync the way the service does, and reads it back as the pane does. */
  async function startSync(): Promise<boolean> {
    assert.isTrue(await handler.handle({ kind: 'sync' }));
    const snapshot = (await handler.handle({
      kind: 'snapshot',
    })) as WalletSnapshotType;
    return snapshot.syncing;
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'swarm-recovery-busy-'));
    lateAnswers = [];
  });

  afterEach(async () => {
    await handler.handle({ kind: 'close' });
    await SwarmWallet.current()?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reads the words while a sync runs, although they take longer than the old limit', async () => {
    await openWallet({ syncKeepsRunning: true, seedDelayMs: 250 });
    const syncing = await startSync();
    assert.isTrue(syncing, 'the snapshot says the wallet is syncing');

    let busyNotices = 0;
    const started = Date.now();
    const outcome = await waitForRecoveryPhrase({
      read: ms => call({ kind: 'seed-phrase' }, ms),
      isBusy: () => syncing,
      onBusy: () => {
        busyNotices += 1;
      },
      limits: LIMITS,
    });

    assert.isAbove(Date.now() - started, LIMITS.quickMs);
    assert.strictEqual(busyNotices, 1, 'the window is told once');
    assert.strictEqual(outcome.type, 'read');
    if (outcome.type !== 'read' || !(outcome.value instanceof Uint8Array)) {
      throw new Error('no words');
    }
    const words = new TextDecoder().decode(outcome.value);
    assert.strictEqual(words, normalizePhrase(phrase));
    outcome.value.fill(0);
  });

  it('says the wallet is busy when it stays busy for the whole wait, and zeroes words that come later', async () => {
    await openWallet({ syncKeepsRunning: true, seedDelayMs: 600 });
    const syncing = await startSync();

    let busyNotices = 0;
    const outcome = await waitForRecoveryPhrase({
      read: ms => call({ kind: 'seed-phrase' }, ms),
      isBusy: () => syncing,
      onBusy: () => {
        busyNotices += 1;
      },
      limits: LIMITS,
    });

    assert.deepStrictEqual(outcome, { type: 'busy' });
    assert.strictEqual(busyNotices, 1);
    await sleep(400);
    assert.lengthOf(lateAnswers, 1);
    assert.instanceOf(lateAnswers[0], Uint8Array);
    assert.isTrue(lateAnswers[0].every(byte => byte === 0));
  });

  it('still fails at the old limit when the wallet is not busy, and zeroes the words that come too late', async () => {
    await openWallet({ seedDelayMs: 300 });

    let arrived: unknown;
    const keep = async (answer: Promise<unknown>): Promise<void> => {
      try {
        arrived = await answer;
      } catch {
        // Not expected; the assertion below says so.
      }
    };
    let busyNotices = 0;
    const outcome = await waitForRecoveryPhrase({
      read: ms => {
        const answer = call({ kind: 'seed-phrase' }, ms);
        drop(keep(answer));
        return answer;
      },
      isBusy: () => false,
      onBusy: () => {
        busyNotices += 1;
      },
      limits: LIMITS,
    });

    assert.strictEqual(outcome.type, 'failed');
    if (outcome.type !== 'failed') {
      throw new Error('not failed');
    }
    assert.strictEqual(codeOf(outcome.error), 'timeout');
    assert.strictEqual(busyNotices, 0);

    await sleep(400);
    assert.instanceOf(arrived, Uint8Array, 'the words did arrive later');
    assert.isTrue(
      arrived.every(byte => byte === 0),
      'and were zeroed, since nobody was waiting for them'
    );
  });

  it('reports a real failure at once, while syncing, without the words', async () => {
    await openWallet({
      syncKeepsRunning: true,
      seedError: 'Error: get seed: no mnemonic found. wallet loaded from key.',
    });
    const syncing = await startSync();

    const started = Date.now();
    const outcome = await waitForRecoveryPhrase({
      read: ms => call({ kind: 'seed-phrase' }, ms),
      isBusy: () => syncing,
      limits: LIMITS,
    });

    assert.isBelow(Date.now() - started, LIMITS.busyWaitMs);
    assert.strictEqual(outcome.type, 'failed');
    if (outcome.type !== 'failed') {
      throw new Error('not failed');
    }
    assert.notStrictEqual(codeOf(outcome.error), 'timeout');
    for (const word of phrase.split(' ')) {
      assert.notInclude(messageOf(outcome.error), ` ${word} `);
    }
  });

  it('does not tell the window anything when the words come at once', async () => {
    await openWallet({ syncKeepsRunning: true });
    const syncing = await startSync();

    let busyNotices = 0;
    const outcome = await waitForRecoveryPhrase({
      read: ms => call({ kind: 'seed-phrase' }, ms),
      isBusy: () => syncing,
      onBusy: () => {
        busyNotices += 1;
      },
      limits: LIMITS,
    });

    assert.strictEqual(outcome.type, 'read');
    if (outcome.type === 'read' && outcome.value instanceof Uint8Array) {
      outcome.value.fill(0);
    }
    await sleep(LIMITS.quickMs + 20);
    assert.strictEqual(busyNotices, 0);
  });

  it('waits when requests ahead of it keep the wallet busy, although no sync runs', async () => {
    // The owner's case: the Wallet pane's `server` request was in the worker
    // ahead of the read, waiting for a slow light server.
    await openWallet({ seedDelayMs: 250 });
    let requestsAhead = true;
    setTimeout(() => {
      requestsAhead = false;
    }, 200);

    const outcome = await waitForRecoveryPhrase({
      read: ms => call({ kind: 'seed-phrase' }, ms),
      isBusy: () => requestsAhead,
      limits: LIMITS,
    });

    assert.strictEqual(outcome.type, 'read');
    if (outcome.type === 'read' && outcome.value instanceof Uint8Array) {
      assert.strictEqual(
        new TextDecoder().decode(outcome.value),
        normalizePhrase(phrase)
      );
      outcome.value.fill(0);
    }
  });
});

describe('SWARM recovery phrase: the wait logs nothing about the words (0.1.3)', () => {
  it('the wait and the worker have no logger at all', () => {
    for (const file of [
      'ts/util/swarm/recoveryPhraseRead.std.ts',
      'ts/workers/swarmWalletHandler.node.ts',
      'ts/workers/swarmWalletWorker.node.ts',
    ]) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      assert.notMatch(text, /console\./, file);
      assert.notMatch(text, /createLogger|logging\/log/, file);
    }
  });

  it("the service's recovery phrase log lines carry a reason at most, never the words", () => {
    const text = readFileSync(
      join(ROOT, 'app', 'SwarmWalletService.main.ts'),
      'utf8'
    );
    const start = text.indexOf('async readRecoveryPhrase(');
    const end = text.indexOf('#hasRequestsBefore(id', start);
    assert.isAbove(start, 0);
    assert.isAbove(end, start);
    const calls = text.slice(start, end).match(/log\.\w+\([\s\S]*?\);/g) ?? [];
    assert.isAtLeast(calls.length, 5);
    for (const logCall of calls) {
      for (const interpolated of logCall.match(/\$\{[^}]*\}/g) ?? []) {
        assert.strictEqual(
          interpolated,
          ['$', '{this.#describe(outcome.error)}'].join(''),
          logCall
        );
      }
    }
  });
});
