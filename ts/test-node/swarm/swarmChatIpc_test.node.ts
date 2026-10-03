// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the three IPC channels payments inside a chat
// added - new-address, check-address, find-transaction - and the memo hash a
// notice carries. What must hold: each channel reads its payload exactly and
// refuses anything else; nothing from the window becomes a path, a server or a
// chain; an address is checked for the network the wallet is on; the memo
// hash is the hash of the bytes the addon puts on-chain; and the new-address
// request asks the addon for a shielded address with both receivers.

import { assert } from 'chai';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SwarmWallet } from 'swarm-wallet-core';
import type { WalletTransaction } from 'swarm-wallet-core';

import {
  checkAddressFor,
  memoBytesAsSent,
  memoHashFor,
  memoVerdictFor,
  parseCheckAddressRequest,
  parseFindTransactionRequest,
  parseNewAddressRequest,
  summarizeFoundTransfers,
} from '../../util/swarm/walletIpc.node.ts';
import {
  SwarmWalletHandler,
  readTransfer,
} from '../../workers/swarmWalletHandler.node.ts';
import type { FoundTransferType } from '../../workers/swarmWalletProtocol.std.ts';
import {
  ConfirmSendResultSchema,
  FindTransactionResultSchema,
} from '../../types/SwarmWallet.std.ts';
import { createFakeSwarmWalletAddon } from '../../test-helpers/fakeSwarmWalletAddon.node.ts';
import {
  bech32mAddress,
  damaged,
} from '../../test-helpers/swarmAddresses.std.ts';

const MAINNET_ADDRESS = bech32mAddress('swm', 21);
const TESTNET_ADDRESS = bech32mAddress('swarm', 21);
const ACCOUNT_KEY = `B${'A'.repeat(43)}`;

function sha256(bytes: Uint8Array<ArrayBuffer>): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function found(overrides: Partial<FoundTransferType> = {}): FoundTransferType {
  return {
    direction: 'in',
    toSelf: false,
    amountZat: '100',
    status: 'confirmed',
    blockHeight: 10,
    memos: [],
    ...overrides,
  };
}

describe('SWARM chat payments: the new IPC channels', () => {
  describe('swarm-wallet:new-address', () => {
    it('takes nothing, and refuses anything', () => {
      assert.isTrue(parseNewAddressRequest(undefined));
      assert.isTrue(parseNewAddressRequest({}));
      assert.isFalse(parseNewAddressRequest({ receivers: 'oz' }));
      assert.isFalse(parseNewAddressRequest({ path: 'C:/elsewhere' }));
      assert.isFalse(parseNewAddressRequest('swarm-mainnet'));
    });

    it('asks the wallet for an Orchard and Sapling address, and saves', async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'swarm-new-address-'));
      const fake = createFakeSwarmWalletAddon({ newAddress: MAINNET_ADDRESS });
      const handler = new SwarmWalletHandler({ loadAddon: () => fake.addon });
      try {
        await handler.handle({
          kind: 'restore',
          location: {
            dataDir,
            walletName: 'wallet-ffeeddccbbaa99887766554433221100.dat',
            chain: 'swarm-mainnet',
            server: 'https://lwd-main.swarm.green:443',
            encryptionKey: new Uint8Array(randomBytes(32)),
          },
          phrase: Array.from({ length: 24 }, () => 'zoo').join(' '),
          birthdayHeight: 1,
        });
        const before = fake.log.calls.length;
        assert.strictEqual(
          await handler.handle({ kind: 'new-address' }),
          MAINNET_ADDRESS
        );
        const calls = fake.log.calls.slice(before);
        assert.include(calls, 'create_new_unified_address');
        assert.include(calls, 'receivers:oz');
        assert.include(calls, 'save_wallet_file');
      } finally {
        await handler.handle({ kind: 'close' });
        await SwarmWallet.current()?.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    });
  });

  describe('swarm-wallet:check-address', () => {
    it('reads an address and nothing else', () => {
      assert.strictEqual(
        parseCheckAddressRequest({ address: ` ${MAINNET_ADDRESS}\n` }),
        MAINNET_ADDRESS
      );
      assert.isUndefined(parseCheckAddressRequest({}));
      assert.isUndefined(parseCheckAddressRequest({ address: 7 }));
      assert.isUndefined(
        parseCheckAddressRequest({ address: 'x'.repeat(1025) })
      );
      assert.isUndefined(parseCheckAddressRequest(MAINNET_ADDRESS));
    });

    it('accepts an address of the wallet’s network', () => {
      assert.deepStrictEqual(checkAddressFor(MAINNET_ADDRESS, 'mainnet'), {
        accepted: true,
        chain: 'swarm-mainnet',
        detail: null,
      });
      assert.deepStrictEqual(checkAddressFor(TESTNET_ADDRESS, 'testnet'), {
        accepted: true,
        chain: 'swarm-testnet',
        detail: null,
      });
    });

    it('refuses the other network’s address, and says which it is', () => {
      const onMainnet = checkAddressFor(TESTNET_ADDRESS, 'mainnet');
      assert.isFalse(onMainnet.accepted);
      assert.match(onMainnet.detail ?? '', /testnet/i);
      const onTestnet = checkAddressFor(MAINNET_ADDRESS, 'testnet');
      assert.isFalse(onTestnet.accepted);
      assert.strictEqual(onTestnet.chain, 'swarm-testnet');
    });

    it('refuses a damaged checksum and a Zcash address', () => {
      assert.isFalse(
        checkAddressFor(damaged(MAINNET_ADDRESS), 'mainnet').accepted
      );
      assert.isFalse(
        checkAddressFor(bech32mAddress('u', 21), 'mainnet').accepted
      );
    });
  });

  describe('swarm-wallet:find-transaction', () => {
    const TXID = '0a'.repeat(32);
    const HASH = 'f0'.repeat(32);

    it('reads a txid, an optional memo hash and an optional account key', () => {
      assert.deepStrictEqual(parseFindTransactionRequest({ txid: TXID }), {
        txid: TXID,
        memoHash: null,
        accountKey: undefined,
      });
      const withAll = parseFindTransactionRequest({
        txid: TXID,
        memoHash: HASH,
        accountKey: ACCOUNT_KEY,
      });
      assert.strictEqual(withAll?.memoHash, HASH);
      assert.strictEqual(withAll?.accountKey?.byteLength, 33);
    });

    it('refuses a txid or a hash that is not 32 bytes of lowercase hex', () => {
      for (const payload of [
        undefined,
        {},
        { txid: TXID.slice(2) },
        { txid: TXID.toUpperCase() },
        { txid: `${TXID}00` },
        { txid: TXID, memoHash: 'f0' },
        { txid: TXID, memoHash: HASH.toUpperCase() },
        { txid: TXID, accountKey: 'not a key' },
        TXID,
      ]) {
        assert.isUndefined(
          parseFindTransactionRequest(payload),
          JSON.stringify(payload)
        );
      }
    });

    it('answers in a shape the window parses', () => {
      const answer = summarizeFoundTransfers([found()], null, 'mainnet');
      assert.isTrue(FindTransactionResultSchema.safeParse(answer).success);
      assert.isTrue(
        FindTransactionResultSchema.safeParse({
          status: 'not-found',
          chain: 'swarm-testnet',
          syncedHeight: null,
          serverHeight: 7,
        }).success
      );
    });
  });

  describe('confirm-send, for a chat', () => {
    it('answers the chain and the memo hash beside the txids', () => {
      assert.isTrue(
        ConfirmSendResultSchema.safeParse({
          ok: true,
          txids: ['ab'.repeat(32)],
          saved: true,
          chain: 'swarm-mainnet',
          memoHash: memoHashFor('hello'),
        }).success
      );
      assert.isFalse(
        ConfirmSendResultSchema.safeParse({
          ok: true,
          txids: ['ab'.repeat(32)],
          saved: true,
          chain: 'zcash-mainnet',
          memoHash: null,
        }).success
      );
    });
  });

  describe('the memo hash', () => {
    it('is SHA-256 of the UTF-8 the addon puts on-chain', () => {
      const memo = 'for the coffee ☕';
      assert.strictEqual(memoHashFor(memo), sha256(Buffer.from(memo, 'utf8')));
    });

    it('is absent when there is no memo', () => {
      assert.isNull(memoHashFor(null));
      assert.isNull(memoHashFor(''));
      // "0x" alone is zero bytes to the addon: no memo either.
      assert.isNull(memoHashFor('0x'));
    });

    it('follows the addon: "0x" and hex is those bytes', () => {
      assert.deepStrictEqual([...memoBytesAsSent('0xCAFE00')], [0xca, 0xfe]);
      assert.strictEqual(
        memoHashFor('0xcafe'),
        sha256(new Uint8Array([0xca, 0xfe]))
      );
      // Odd length or a non-hex digit is not hex to the addon: plain text.
      assert.deepStrictEqual(
        [...memoBytesAsSent('0xabc')],
        [...Buffer.from('0xabc', 'utf8')]
      );
      assert.deepStrictEqual(
        [...memoBytesAsSent('0xzz')],
        [...Buffer.from('0xzz', 'utf8')]
      );
    });

    it('leaves out the zero padding, as the recipient’s wallet does', () => {
      assert.deepStrictEqual(
        [...memoBytesAsSent('hi\u0000\u0000')],
        [0x68, 0x69]
      );
      assert.strictEqual(memoHashFor('hi\u0000'), memoHashFor('hi'));
    });

    it('matches the text memo the recipient’s wallet reads', () => {
      const hash = memoHashFor('invoice 42');
      assert.strictEqual(memoVerdictFor(hash, ['invoice 42']), 'match');
      assert.strictEqual(memoVerdictFor(hash, ['invoice 43']), 'mismatch');
      assert.strictEqual(
        memoVerdictFor(hash, ['other', 'invoice 42']),
        'match'
      );
      assert.strictEqual(memoVerdictFor(hash, []), 'unreadable');
      assert.strictEqual(memoVerdictFor(null, []), 'none');
      assert.strictEqual(memoVerdictFor(null, ['']), 'none');
      assert.strictEqual(memoVerdictFor(null, ['surprise']), 'mismatch');
    });
  });

  describe('one transaction, from its value transfers', () => {
    it('sums what came in across pools and leaves change out of what went out', () => {
      const answer = summarizeFoundTransfers(
        [
          found({ amountZat: '600' }),
          found({ amountZat: '400' }),
          found({ direction: 'out', amountZat: '50' }),
          found({ direction: 'out', toSelf: true, amountZat: '7' }),
        ],
        null,
        'testnet'
      );
      assert.include(answer, {
        status: 'found',
        chain: 'swarm-testnet',
        receivedZat: '1000',
        sentZat: '50',
        confirmed: true,
        failed: false,
        blockHeight: 10,
      });
    });

    it('is confirmed only when every part is, and has no block until then', () => {
      const answer = summarizeFoundTransfers(
        [found(), found({ status: 'pending', blockHeight: 11 })],
        null,
        'mainnet'
      );
      assert.include(answer, { confirmed: false, blockHeight: null });
    });

    it('says when the network did not take it', () => {
      assert.include(
        summarizeFoundTransfers(
          [found({ direction: 'out', status: 'failed' })],
          null,
          'mainnet'
        ),
        { failed: true, confirmed: false }
      );
    });
  });

  describe('reading a value transfer as the SDK writes it', () => {
    function transaction(
      raw: Record<string, unknown>,
      overrides: Partial<WalletTransaction> = {}
    ): WalletTransaction {
      return {
        txid: '1'.repeat(64),
        kind: 'received',
        direction: 'in',
        amountZat: 5n,
        feeZat: null,
        blockHeight: 100,
        timestamp: null,
        address: null,
        memo: null,
        raw,
        ...overrides,
      };
    }

    it('reads the status, not the height, for "in a block"', () => {
      assert.strictEqual(
        readTransfer(transaction({ status: 'confirmed' })).status,
        'confirmed'
      );
      for (const status of ['mempool', 'transmitted', 'calculated']) {
        assert.strictEqual(
          readTransfer(transaction({ status })).status,
          'pending'
        );
      }
      assert.strictEqual(
        readTransfer(transaction({ status: 'failed' })).status,
        'failed'
      );
      // An answer without a status: the height decides, as before.
      assert.strictEqual(readTransfer(transaction({})).status, 'confirmed');
      assert.strictEqual(
        readTransfer(transaction({}, { blockHeight: null })).status,
        'pending'
      );
    });

    it('reads the memos the SDK writes as an array', () => {
      assert.deepStrictEqual(
        readTransfer(transaction({ memos: ['a', '', 'b', 'a', 7] })).memos,
        ['a', 'b']
      );
      assert.deepStrictEqual(
        readTransfer(transaction({}, { memo: 'single' })).memos,
        ['single']
      );
    });

    it('knows a payment to this wallet’s own addresses', () => {
      for (const kind of ['send-to-self', 'memo-to-self', 'shield']) {
        assert.isTrue(
          readTransfer(transaction({}, { kind, direction: 'out' })).toSelf,
          kind
        );
      }
      assert.isFalse(
        readTransfer(transaction({}, { kind: 'sent', direction: 'out' })).toSelf
      );
    });
  });
});
