// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): SWARM payment messages through upstream's own
// seam, processDataMessage -> processPayment. What must hold: a notice for the
// network this wallet is on becomes a payment event on the message; one for the
// other network, or in a group, is refused (the message carries no payment);
// address requests and shares are payment events too; upstream's MobileCoin
// items are processed as before.

import { assert } from 'chai';

import * as Bytes from '../../Bytes.std.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import { processDataMessage } from '../../textsecure/processDataMessage.preload.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import {
  getSwarmWalletChain,
  noteSwarmWalletChain,
  resetSwarmWalletChainForTests,
} from '../../util/swarm/swarmWalletChain.dom.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const TIMESTAMP = 1_790_000_000_000;
const TXID = 'e1'.repeat(32);
const TESTNET_ADDRESS = bech32mAddress('swarm', 9);

const EMPTY: Proto.DataMessage.Params = {
  body: null,
  attachments: null,
  groupV2: null,
  flags: null,
  expireTimer: null,
  expireTimerVersion: null,
  profileKey: null,
  timestamp: BigInt(TIMESTAMP),
  quote: null,
  contact: null,
  preview: null,
  sticker: null,
  requiredProtocolVersion: null,
  isViewOnce: null,
  reaction: null,
  delete: null,
  bodyRanges: null,
  groupCallUpdate: null,
  payment: null,
  storyContext: null,
  giftBadge: null,
  pollCreate: null,
  pollTerminate: null,
  pollVote: null,
  pinMessage: null,
  unpinMessage: null,
  adminDelete: null,
  swarmAddress: null,
};

function check(message: Partial<Proto.DataMessage.Params>) {
  return processDataMessage(
    Proto.DataMessage.decode(
      Proto.DataMessage.encode({ ...EMPTY, ...message })
    ),
    TIMESTAMP,
    { _createName: () => 'unused' }
  );
}

function notice(chain: string): Proto.DataMessage.Payment.Params {
  return {
    Item: {
      swarmNotification: {
        txid: Bytes.fromHex(TXID),
        amountZat: 500_000n,
        memoHash: null,
        senderAddress: null,
        chain,
        note: null,
      },
    },
  };
}

describe('SWARM chat payments: processDataMessage', () => {
  afterEach(() => {
    resetSwarmWalletChainForTests();
  });

  it('holds notices to mainnet unless told otherwise', () => {
    assert.strictEqual(getSwarmWalletChain(), 'swarm-mainnet');
  });

  it('turns a notice for this network into a payment event', () => {
    const out = check({ payment: notice('swarm-mainnet') });
    assert.deepStrictEqual(out.payment, {
      kind: PaymentEventKind.SwarmNotification,
      txid: TXID,
      amountZat: '500000',
      memoHash: null,
      chain: 'swarm-mainnet',
      senderAddress: null,
      note: null,
    });
  });

  it('refuses a notice for the other network: the message carries no payment', () => {
    assert.isUndefined(check({ payment: notice('swarm-testnet') }).payment);

    noteSwarmWalletChain('swarm-testnet');
    assert.isUndefined(check({ payment: notice('swarm-mainnet') }).payment);
    assert.strictEqual(
      check({ payment: notice('swarm-testnet') }).payment?.kind,
      PaymentEventKind.SwarmNotification
    );
  });

  it('ignores a chain label it does not know when told the network', () => {
    noteSwarmWalletChain('zcash-mainnet');
    assert.strictEqual(getSwarmWalletChain(), 'swarm-mainnet');
  });

  it('refuses a notice sent to a group', () => {
    const out = check({
      payment: notice('swarm-mainnet'),
      groupV2: {
        masterKey: new Uint8Array(32),
        revision: 1,
        groupChange: null,
      },
    });
    assert.isUndefined(out.payment);
  });

  it('turns an address request and an address share into payment events', () => {
    noteSwarmWalletChain('swarm-testnet');
    assert.deepStrictEqual(
      check({
        swarmAddress: {
          type: Proto.DataMessage.SwarmAddress.Type.REQUEST,
          address: null,
          chain: 'swarm-testnet',
        },
      }).payment,
      { kind: PaymentEventKind.SwarmAddressRequest, chain: 'swarm-testnet' }
    );
    assert.deepStrictEqual(
      check({
        swarmAddress: {
          type: Proto.DataMessage.SwarmAddress.Type.SHARE,
          address: TESTNET_ADDRESS,
          chain: 'swarm-testnet',
        },
      }).payment,
      {
        kind: PaymentEventKind.SwarmAddressShare,
        chain: 'swarm-testnet',
        address: TESTNET_ADDRESS,
      }
    );
  });

  it('refuses an address for the other network', () => {
    assert.isUndefined(
      check({
        swarmAddress: {
          type: Proto.DataMessage.SwarmAddress.Type.SHARE,
          address: TESTNET_ADDRESS,
          chain: 'swarm-testnet',
        },
      }).payment
    );
  });

  it('still processes upstream payment items as before', () => {
    assert.deepStrictEqual(
      check({
        payment: {
          Item: {
            notification: { Transaction: null, note: 'upstream' },
          },
        },
      }).payment,
      { kind: PaymentEventKind.Notification, note: 'upstream' }
    );
    assert.deepStrictEqual(
      check({
        payment: {
          Item: {
            activation: {
              type: Proto.DataMessage.Payment.Activation.Type.REQUEST,
            },
          },
        },
      }).payment,
      { kind: PaymentEventKind.ActivationRequest }
    );
  });
});
