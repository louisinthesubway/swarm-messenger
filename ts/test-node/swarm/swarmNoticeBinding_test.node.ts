// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): a payment notice bound to the transaction it
// names, end to end below the window: the worker's handler asks a (fake) wallet
// addon for the transaction's value transfers in the SDK's own shape, the main
// process sums them (summarizeFoundTransfers), and the bubble's view follows
// (bindSwarmNotice).
//
// The rule held here: a notice is never shown as money received on its own
// word. "Received" appears only when this wallet has the transaction in a
// block with value to it, and the amount is the wallet's; until then the
// notice says it is waiting. A memo that is not the one the notice describes,
// or an amount the notice overstated, is visible.

import { assert } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { SwarmWallet } from 'swarm-wallet-core';

import { SwarmWalletHandler } from '../../workers/swarmWalletHandler.node.ts';
import type {
  FoundTransferType,
  WalletLocationType,
  WalletSnapshotType,
} from '../../workers/swarmWalletProtocol.std.ts';
import {
  memoHashFor,
  summarizeFoundTransfers,
} from '../../util/swarm/walletIpc.node.ts';
import { bindSwarmNotice } from '../../util/swarm/swarmNoticeBinding.std.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type { SwarmPaymentNotificationEvent } from '../../types/Payment.std.ts';
import type { FindTransactionResultType } from '../../types/SwarmWallet.std.ts';
import { createFakeSwarmWalletAddon } from '../../test-helpers/fakeSwarmWalletAddon.node.ts';

const PHRASE = Array.from({ length: 24 }, () => 'zoo').join(' ');
const TXID = '9c'.repeat(32);
const OTHER_TXID = '3d'.repeat(32);
const MEMO = 'for the coffee';

/** A value transfer as zingolib's `ValueTransfer` JSON writes it. */
function transfer(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    txid: TXID,
    datetime: 1_790_000_000,
    status: 'confirmed',
    blockheight: 7005,
    transaction_fee: null,
    zec_price: null,
    kind: 'received',
    value: 600_000,
    recipient_address: null,
    pools_sent_from: [],
    pools_received: ['orchard'],
    memos: [MEMO],
    ...overrides,
  };
}

function notice(
  overrides: Partial<SwarmPaymentNotificationEvent> = {}
): SwarmPaymentNotificationEvent {
  return {
    kind: PaymentEventKind.SwarmNotification,
    txid: TXID,
    amountZat: '1000000',
    memoHash: memoHashFor(MEMO),
    chain: 'swarm-mainnet',
    senderAddress: null,
    note: null,
    ...overrides,
  };
}

describe('SWARM chat payments: a notice bound to the wallet', () => {
  let dataDir: string;
  let handler: SwarmWalletHandler;

  async function walletWith(
    valueTransfers: ReadonlyArray<Record<string, unknown>>
  ): Promise<void> {
    const fake = createFakeSwarmWalletAddon({ valueTransfers });
    handler = new SwarmWalletHandler({ loadAddon: () => fake.addon });
    const location: WalletLocationType = {
      dataDir,
      walletName: 'wallet-00112233445566778899aabbccddeeff.dat',
      chain: 'swarm-mainnet',
      server: 'https://lwd-main.swarm.green:8443',
      encryptionKey: new Uint8Array(randomBytes(32)),
    };
    await handler.handle({
      kind: 'restore',
      location,
      phrase: PHRASE,
      birthdayHeight: 1,
    });
  }

  /** What the main process answers swarm-wallet:find-transaction with. */
  async function lookup(
    txid: string,
    claimedMemoHash: string | null
  ): Promise<FindTransactionResultType> {
    const transfers = (await handler.handle({
      kind: 'find-transaction',
      txid,
    })) as ReadonlyArray<FoundTransferType>;
    if (transfers.length === 0) {
      return {
        status: 'not-found',
        chain: 'swarm-mainnet',
        syncedHeight: 7005,
        serverHeight: 7005,
      };
    }
    return summarizeFoundTransfers(transfers, claimedMemoHash, 'mainnet');
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'swarm-notice-binding-'));
  });

  afterEach(async () => {
    await handler?.handle({ kind: 'close' });
    await SwarmWallet.current()?.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('waits while the wallet has not seen the transaction', async () => {
    await walletWith([transfer({ txid: OTHER_TXID })]);
    const view = bindSwarmNotice(
      notice(),
      'incoming',
      await lookup(TXID, notice().memoHash)
    );
    assert.deepStrictEqual(view, {
      state: 'waiting',
      claimedZat: '1000000',
      walletClosed: false,
    });
  });

  it('waits, and says why, while the wallet is not open', () => {
    const view = bindSwarmNotice(notice(), 'incoming', {
      status: 'wallet-not-ready',
      chain: 'swarm-mainnet',
      wallet: 'opening',
    });
    assert.deepStrictEqual(view, {
      state: 'waiting',
      claimedZat: '1000000',
      walletClosed: true,
    });
  });

  it('never calls a notice received before the wallet answered', () => {
    assert.strictEqual(
      bindSwarmNotice(notice(), 'incoming', undefined).state,
      'waiting'
    );
  });

  it('says received, with the amount from the wallet summed over its pools', async () => {
    await walletWith([
      transfer(),
      // The same transaction, received into a second pool.
      transfer({ value: 400_000, pools_received: ['sapling'], memos: [] }),
    ]);
    const found = await lookup(TXID, notice().memoHash);
    assert.include(found, {
      status: 'found',
      receivedZat: '1000000',
      sentZat: '0',
      confirmed: true,
      failed: false,
      blockHeight: 7005,
      memo: 'match',
      memoText: MEMO,
    });
    assert.deepStrictEqual(bindSwarmNotice(notice(), 'incoming', found), {
      state: 'received',
      walletZat: '1000000',
      claimedZat: null,
      blockHeight: 7005,
      memo: 'match',
      memoText: MEMO,
    });
  });

  it('shows what arrived, not what the notice claimed', async () => {
    await walletWith([transfer({ value: 900_000 })]);
    const view = bindSwarmNotice(
      notice(),
      'incoming',
      await lookup(TXID, notice().memoHash)
    );
    assert.deepStrictEqual(view, {
      state: 'received',
      walletZat: '900000',
      claimedZat: '1000000',
      blockHeight: 7005,
      memo: 'match',
      memoText: MEMO,
    });
  });

  it('says the wallet sees it, not received, while it is not in a block', async () => {
    await walletWith([transfer({ status: 'mempool', blockheight: 7006 })]);
    const found = await lookup(TXID, notice().memoHash);
    assert.include(found, { confirmed: false, blockHeight: null });
    assert.strictEqual(
      bindSwarmNotice(notice(), 'incoming', found).state,
      'seen'
    );
  });

  it('makes a memo that is not the notice’s visible', async () => {
    await walletWith([transfer({ memos: ['something else'] })]);
    const view = bindSwarmNotice(
      notice(),
      'incoming',
      await lookup(TXID, notice().memoHash)
    );
    assert.strictEqual(view.state, 'received');
    if (view.state === 'received') {
      assert.strictEqual(view.memo, 'mismatch');
    }
  });

  it('says so when the wallet cannot read the memo the notice names', async () => {
    await walletWith([transfer({ memos: [] })]);
    const view = bindSwarmNotice(
      notice(),
      'incoming',
      await lookup(TXID, notice().memoHash)
    );
    assert.strictEqual(view.state, 'received');
    if (view.state === 'received') {
      assert.strictEqual(view.memo, 'unreadable');
    }
  });

  it('is not received when nothing in the transaction came to this wallet', async () => {
    await walletWith([
      transfer({ kind: 'sent', value: 1_000_000, memos: [MEMO] }),
    ]);
    assert.deepStrictEqual(
      bindSwarmNotice(
        notice(),
        'incoming',
        await lookup(TXID, notice().memoHash)
      ),
      { state: 'not-to-you' }
    );
  });

  it('is not bound by a wallet on the other network', async () => {
    await walletWith([transfer()]);
    const found = await lookup(TXID, notice().memoHash);
    const testnetNotice = notice({ chain: 'swarm-testnet' });
    assert.strictEqual(
      bindSwarmNotice(testnetNotice, 'incoming', found).state,
      'waiting'
    );
  });

  describe('a notice this account sent', () => {
    it('follows the payment from the mempool into a block', async () => {
      await walletWith([
        transfer({
          kind: 'sent',
          status: 'transmitted',
          value: 1_000_000,
          memos: [MEMO],
        }),
        // Change back to this wallet: not what was paid.
        transfer({
          kind: 'memo-to-self',
          status: 'transmitted',
          value: 50_000,
          memos: [],
        }),
      ]);
      const pending = await lookup(TXID, notice().memoHash);
      assert.include(pending, { sentZat: '1000000', confirmed: false });
      assert.deepStrictEqual(bindSwarmNotice(notice(), 'outgoing', pending), {
        state: 'sent-waiting',
      });
    });

    it('says the block once it is in one', async () => {
      await walletWith([transfer({ kind: 'sent', value: 1_000_000 })]);
      assert.deepStrictEqual(
        bindSwarmNotice(
          notice(),
          'outgoing',
          await lookup(TXID, notice().memoHash)
        ),
        { state: 'sent-confirmed', blockHeight: 7005 }
      );
    });

    it('says when the network did not take it', async () => {
      await walletWith([
        transfer({ kind: 'sent', status: 'failed', value: 1_000_000 }),
      ]);
      assert.deepStrictEqual(
        bindSwarmNotice(
          notice(),
          'outgoing',
          await lookup(TXID, notice().memoHash)
        ),
        { state: 'sent-failed' }
      );
    });
  });

  describe('what the Wallet pane shows from the same transfers', () => {
    it('shows the memo the SDK writes in `memos`, and no block while pending', async () => {
      await walletWith([
        transfer({ status: 'mempool', blockheight: 7006 }),
        transfer({ txid: OTHER_TXID }),
      ]);
      const snapshot = (await handler.handle({
        kind: 'snapshot',
      })) as WalletSnapshotType;
      const pending = snapshot.transactions.find(({ txid }) => txid === TXID);
      const confirmed = snapshot.transactions.find(
        ({ txid }) => txid === OTHER_TXID
      );
      assert.strictEqual(pending?.memo, MEMO);
      assert.isNull(pending?.blockHeight);
      assert.strictEqual(confirmed?.blockHeight, 7005);
    });
  });
});
