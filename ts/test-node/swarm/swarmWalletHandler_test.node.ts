// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): the wallet worker's request handler, driven with a fake
// addon. The rules held here: an empty directory is never filled with a seed of
// the handler's own; the wallet file is sealed at rest; a payment is confirmed
// only as the quote it was shown, once, and not after it expires.

import { assert } from 'chai';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { SwarmWallet } from 'swarm-wallet-core';

import {
  QUOTE_LIFETIME_MS,
  SwarmWalletHandler,
  readHeight,
  toWorkerError,
  walletFileExists,
} from '../../workers/swarmWalletHandler.node.ts';
import type {
  QuoteSnapshotType,
  SendSnapshotType,
  WalletLocationType,
  WalletSnapshotType,
} from '../../workers/swarmWalletProtocol.std.ts';
import {
  FAKE_UNIFIED_ADDRESS,
  createFakeSwarmWalletAddon,
} from '../../test-helpers/fakeSwarmWalletAddon.node.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const PHRASE = Array.from({ length: 24 }, () => 'zoo').join(' ');

describe('SWARM wallet: the worker handler', () => {
  let dataDir: string;
  let key: Uint8Array<ArrayBuffer>;
  let now: number;
  let handler: SwarmWalletHandler;
  let fake: ReturnType<typeof createFakeSwarmWalletAddon>;

  const location = (
    overrides: Partial<WalletLocationType> = {}
  ): WalletLocationType => ({
    dataDir,
    walletName: 'wallet-0123456789abcdef0123456789abcdef.dat',
    chain: 'swarm-mainnet',
    server: 'https://lwd-main.swarm.green:8443',
    // A copy each time, as the service hands the worker a copy.
    encryptionKey: new Uint8Array(key),
    ...overrides,
  });

  const make = (spendable = 0): void => {
    fake = createFakeSwarmWalletAddon({ spendable });
    handler = new SwarmWalletHandler({
      loadAddon: () => fake.addon,
      now: () => now,
    });
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'swarm-wallet-handler-'));
    key = new Uint8Array(randomBytes(32));
    now = 1_000_000;
    make();
  });

  afterEach(async () => {
    await handler.handle({ kind: 'close' });
    // The addon slot is process-wide; make sure no test leaves it taken.
    await SwarmWallet.current()?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('refuses to open where there is no wallet, instead of creating one', async () => {
    let caught: unknown;
    try {
      await handler.handle({ kind: 'open', location: location() });
    } catch (error) {
      caught = error;
    }
    assert.strictEqual(toWorkerError(caught).code, 'no-wallet');
    assert.notInclude(fake.log.calls, 'init_new');
    assert.isFalse(await walletFileExists(location()));
  });

  it('restores from the phrase, seals the file, and opens it again later', async () => {
    const where = location();
    assert.isTrue(
      await handler.handle({
        kind: 'restore',
        location: where,
        phrase: PHRASE,
        birthdayHeight: 1338,
      })
    );
    assert.deepStrictEqual(fake.log.seedsGiven, [24]);
    assert.include(fake.log.calls, 'birthday:1338');

    await handler.handle({ kind: 'close' });
    const chainDir = join(dataDir, 'swarm-mainnet');
    // At rest: the sealed file, and no plaintext beside it.
    assert.deepStrictEqual(readdirSync(chainDir).sort(), [
      `${where.walletName}.enc`,
    ]);
    assert.isTrue(await walletFileExists(where));

    // Opening again reads the file; it does not restore a second time.
    make();
    assert.isTrue(await handler.handle({ kind: 'open', location: location() }));
    assert.include(fake.log.calls, 'init_from_b64');
    assert.deepStrictEqual(fake.log.seedsGiven, []);
  });

  it('opens an existing wallet rather than restoring over it', async () => {
    await handler.handle({
      kind: 'restore',
      location: location(),
      phrase: PHRASE,
      birthdayHeight: 1,
    });
    await handler.handle({ kind: 'close' });
    make();
    await handler.handle({
      kind: 'restore',
      location: location(),
      phrase: PHRASE,
      birthdayHeight: 1,
    });
    assert.include(fake.log.calls, 'init_from_b64');
    assert.notInclude(fake.log.calls, 'init_from_seed');
  });

  it('reports what the pane shows, as strings, newest first', async () => {
    make(123_456_789);
    await handler.handle({
      kind: 'restore',
      location: location(),
      phrase: PHRASE,
      birthdayHeight: 1,
    });
    const snapshot = (await handler.handle({
      kind: 'snapshot',
    })) as WalletSnapshotType;
    assert.strictEqual(snapshot.spendableZat, '123456789');
    assert.strictEqual(snapshot.totalZat, '123481789');
    assert.strictEqual(snapshot.pendingZat, '25000');
    assert.strictEqual(snapshot.address, FAKE_UNIFIED_ADDRESS);
    assert.strictEqual(snapshot.syncedHeight, 1438);
    // The malformed txid is dropped, the upper-case one normalised, and the
    // newest is first.
    assert.deepStrictEqual(
      snapshot.transactions.map(({ txid, direction }) => [txid, direction]),
      [
        ['bb'.repeat(32), 'out'],
        ['aa'.repeat(32), 'in'],
      ]
    );
    assert.strictEqual(snapshot.transactions[1]?.memo, 'for the coffee');
    assert.strictEqual(snapshot.transactions[0]?.feeZat, '10000');

    const server = await handler.handle({ kind: 'server' });
    assert.deepStrictEqual(server, {
      chainName: 'swarm-mainnet',
      blockHeight: 1438,
      genesisVerified: true,
    });
  });

  it('asks the light server for its height without a wallet', async () => {
    const height = await handler.handle({
      kind: 'server-height',
      server: 'https://lwd-main.swarm.green:8443',
    });
    assert.strictEqual(height, 1438);
  });

  describe('sending', () => {
    const to = bech32mAddress('swm', 5);

    beforeEach(async () => {
      make(100_000_000);
      await handler.handle({
        kind: 'restore',
        location: location(),
        phrase: PHRASE,
        birthdayHeight: 1,
      });
    });

    const quote = async (): Promise<QuoteSnapshotType> =>
      (await handler.handle({
        kind: 'quote',
        to,
        amountZat: '1000',
        memo: null,
      })) as QuoteSnapshotType;

    const confirmError = async (quoteId: string): Promise<string> => {
      try {
        await handler.handle({ kind: 'confirm', quoteId });
      } catch (error) {
        return toWorkerError(error).code;
      }
      return 'sent';
    };

    it('quotes a fee and transmits only on confirm', async () => {
      const quoted = await quote();
      assert.match(quoted.quoteId, /^[0-9a-f]{32}$/);
      assert.strictEqual(quoted.feeZat, '10000');
      assert.notInclude(fake.log.calls, 'confirm');

      const sent = (await handler.handle({
        kind: 'confirm',
        quoteId: quoted.quoteId,
      })) as SendSnapshotType;
      assert.deepStrictEqual(sent, { txids: ['cc'.repeat(32)], saved: true });
    });

    it('confirms a quote once, and never a quote it did not issue', async () => {
      const quoted = await quote();
      assert.strictEqual(await confirmError('0'.repeat(32)), 'quote-expired');
      // The wrong id used the quote up.
      assert.strictEqual(await confirmError(quoted.quoteId), 'quote-expired');

      const again = await quote();
      assert.strictEqual(await confirmError(again.quoteId), 'sent');
      assert.strictEqual(await confirmError(again.quoteId), 'quote-expired');
    });

    it('refuses a quote that has expired', async () => {
      const quoted = await quote();
      now += QUOTE_LIFETIME_MS + 1;
      assert.strictEqual(await confirmError(quoted.quoteId), 'quote-expired');
      assert.notInclude(fake.log.calls, 'confirm');
    });

    it('lets a newer quote replace an older one', async () => {
      const first = await quote();
      const second = await quote();
      assert.strictEqual(await confirmError(first.quoteId), 'quote-expired');
      assert.notStrictEqual(first.quoteId, second.quoteId);
    });

    it('passes the wallet’s own refusal through', async () => {
      await handler.handle({ kind: 'close' });
      fake = createFakeSwarmWalletAddon({
        spendable: 100_000_000,
        sendError: 'Insufficient balance: need 1010000',
      });
      handler = new SwarmWalletHandler({ loadAddon: () => fake.addon });
      await handler.handle({ kind: 'open', location: location() });
      let message = '';
      try {
        await quote();
      } catch (error) {
        message = toWorkerError(error).message;
      }
      assert.include(message, 'Insufficient balance');
    });
  });

  it('reopens the same seed on the other network inside the worker', async () => {
    await handler.handle({
      kind: 'restore',
      location: location(),
      phrase: PHRASE,
      birthdayHeight: 1,
    });
    await handler.handle({
      kind: 'switch',
      location: location({
        chain: 'swarm-testnet',
        server: 'https://lwd.swarm.green:443',
      }),
      birthdayHeight: 1,
    });
    assert.isTrue(existsSync(join(dataDir, 'swarm-testnet')));
    const server = await handler.handle({ kind: 'server' });
    assert.deepStrictEqual(server, {
      chainName: 'swarm-testnet',
      blockHeight: 1438,
      genesisVerified: true,
    });
  });

  it('reads the light server height in both of its answers', () => {
    assert.strictEqual(readHeight('1438'), 1438);
    assert.strictEqual(readHeight(1438), 1438);
    assert.strictEqual(readHeight('{"height": 77}'), 77);
    assert.isUndefined(readHeight('{"error": "no"}'));
    assert.isUndefined(readHeight(-1));
    assert.isUndefined(readHeight('nonsense'));
  });
});
