// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the in-chat payment message, on the wire and back.
// What must hold: the two new fields take the next free numbers and nothing
// upstream moves; a notice and an address survive encode -> decode -> process
// exactly; and what must not be shown - another network, a group, a notice
// with no txid or no amount - is refused.

import { assert } from 'chai';

import * as Bytes from '../../Bytes.std.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type {
  SwarmAddressShareEvent,
  SwarmPaymentNotificationEvent,
} from '../../types/Payment.std.ts';
import {
  SWARM_ADDRESS_MAX_LENGTH,
  SWARM_NOTE_MAX_LENGTH,
  processSwarmAddressMessage,
  processSwarmPaymentNotice,
  toSwarmDataMessageFields,
} from '../../util/swarm/swarmChatPayments.std.ts';
import type { SwarmReceiveContextType } from '../../util/swarm/swarmChatPayments.std.ts';
import { MAX_SWM_ZATOSHI } from '../../util/swarm/swmAmount.std.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const MAINNET: SwarmReceiveContextType = {
  walletChain: 'swarm-mainnet',
  inGroup: false,
};
const TESTNET: SwarmReceiveContextType = {
  walletChain: 'swarm-testnet',
  inGroup: false,
};

const TXID = '5f'.repeat(16) + '0a'.repeat(16);
const MEMO_HASH = 'c3'.repeat(32);
const MAINNET_ADDRESS = bech32mAddress('swm', 3);
const TESTNET_ADDRESS = bech32mAddress('swarm', 3);

const NOTICE: SwarmPaymentNotificationEvent = {
  kind: PaymentEventKind.SwarmNotification,
  txid: TXID,
  amountZat: '1250000',
  memoHash: MEMO_HASH,
  chain: 'swarm-mainnet',
  senderAddress: MAINNET_ADDRESS,
  note: 'for the coffee',
};

function noticeParams(
  overrides: Partial<Proto.DataMessage.Payment.SwarmNotification.Params> = {}
): Proto.DataMessage.Payment.SwarmNotification.Params {
  return {
    txid: Bytes.fromHex(TXID),
    amountZat: 1_250_000n,
    memoHash: Bytes.fromHex(MEMO_HASH),
    senderAddress: MAINNET_ADDRESS,
    chain: 'swarm-mainnet',
    note: 'for the coffee',
    ...overrides,
  };
}

/** A notice as the recipient's client decodes it off the wire. */
function received(
  overrides: Partial<Proto.DataMessage.Payment.SwarmNotification.Params> = {}
): Proto.DataMessage.Payment.SwarmNotification {
  const bytes = Proto.DataMessage.Payment.encode({
    Item: { swarmNotification: noticeParams(overrides) },
  });
  const decoded = Proto.DataMessage.Payment.decode(bytes);
  const notice = decoded.Item?.swarmNotification;
  if (notice == null) {
    throw new Error('the notice did not survive decoding');
  }
  return notice;
}

function receivedAddress(
  params: Partial<Proto.DataMessage.SwarmAddress.Params>
): Proto.DataMessage.SwarmAddress {
  const bytes = Proto.DataMessage.SwarmAddress.encode({
    type: null,
    address: null,
    chain: null,
    ...params,
  });
  return Proto.DataMessage.SwarmAddress.decode(bytes);
}

describe('SWARM chat payments: the message on the wire', () => {
  describe('field numbers', () => {
    it('puts the notice in Payment.Item field 3, after upstream 1 and 2', () => {
      const bytes = Proto.DataMessage.Payment.encode({
        Item: {
          swarmNotification: {
            txid: null,
            amountZat: null,
            memoHash: null,
            senderAddress: null,
            chain: 'x',
            note: null,
          },
        },
      });
      // key (3 << 3 | 2) = 0x1a, length 3, then chain = field 5: 0x2a, 1, 'x'
      assert.deepStrictEqual([...bytes], [0x1a, 3, 0x2a, 1, 0x78]);
    });

    it('puts the address message in DataMessage field 30, the next free one', () => {
      const bytes = Proto.DataMessage.SwarmAddress.encode({
        type: Proto.DataMessage.SwarmAddress.Type.REQUEST,
        address: null,
        chain: 'x',
      });
      const wrapped = Proto.DataMessage.decode(
        new Uint8Array([0xf2, 0x01, bytes.byteLength, ...bytes])
      );
      assert.strictEqual(
        wrapped.swarmAddress?.type,
        Proto.DataMessage.SwarmAddress.Type.REQUEST
      );
      assert.strictEqual(wrapped.swarmAddress?.chain, 'x');
    });

    it('leaves upstream payment items where they were', () => {
      const activation = Proto.DataMessage.Payment.decode(
        Proto.DataMessage.Payment.encode({
          Item: {
            activation: {
              type: Proto.DataMessage.Payment.Activation.Type.ACTIVATED,
            },
          },
        })
      );
      assert.strictEqual(
        activation.Item?.activation?.type,
        Proto.DataMessage.Payment.Activation.Type.ACTIVATED
      );
      // Field 2, as upstream numbered it.
      assert.strictEqual(
        Proto.DataMessage.Payment.encode({
          Item: {
            activation: {
              type: Proto.DataMessage.Payment.Activation.Type.ACTIVATED,
            },
          },
        })[0],
        0x12
      );
    });
  });

  describe('a payment notice', () => {
    it('survives the round trip exactly', () => {
      const processed = processSwarmPaymentNotice(received(), MAINNET);
      assert.deepStrictEqual(processed, { ok: true, event: NOTICE });
    });

    it('comes back from the event it was sent from', () => {
      const { payment, swarmAddress } = toSwarmDataMessageFields(NOTICE);
      assert.isNull(swarmAddress);
      const decoded = Proto.DataMessage.decode(
        Proto.DataMessage.encode({
          body: null,
          attachments: null,
          groupV2: null,
          flags: null,
          expireTimer: null,
          expireTimerVersion: null,
          profileKey: null,
          timestamp: 1n,
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
          payment,
          storyContext: null,
          giftBadge: null,
          pollCreate: null,
          pollTerminate: null,
          pollVote: null,
          pinMessage: null,
          unpinMessage: null,
          adminDelete: null,
          swarmAddress: null,
        })
      );
      const notice = decoded.payment?.Item?.swarmNotification;
      assert.isDefined(notice);
      if (notice == null) {
        return;
      }
      assert.deepStrictEqual(processSwarmPaymentNotice(notice, MAINNET), {
        ok: true,
        event: NOTICE,
      });
    });

    it('may leave out the memo hash, the address and the note', () => {
      const processed = processSwarmPaymentNotice(
        received({ memoHash: null, senderAddress: null, note: null }),
        MAINNET
      );
      assert.deepStrictEqual(processed, {
        ok: true,
        event: { ...NOTICE, memoHash: null, senderAddress: null, note: null },
      });
    });

    it('is refused for the other network, both ways', () => {
      assert.deepStrictEqual(processSwarmPaymentNotice(received(), TESTNET), {
        ok: false,
        refusal: 'wrong-chain',
      });
      assert.deepStrictEqual(
        processSwarmPaymentNotice(
          received({ chain: 'swarm-testnet', senderAddress: TESTNET_ADDRESS }),
          MAINNET
        ),
        { ok: false, refusal: 'wrong-chain' }
      );
    });

    it('is refused with no chain, or a chain this app does not know', () => {
      for (const chain of [
        null,
        '',
        'main',
        'zcash-mainnet',
        'SWARM-MAINNET',
      ]) {
        assert.deepStrictEqual(
          processSwarmPaymentNotice(received({ chain }), MAINNET),
          { ok: false, refusal: 'wrong-chain' },
          String(chain)
        );
      }
    });

    it('is refused in a group', () => {
      assert.deepStrictEqual(
        processSwarmPaymentNotice(received(), { ...MAINNET, inGroup: true }),
        { ok: false, refusal: 'in-group' }
      );
    });

    it('is refused without a 32-byte txid', () => {
      for (const txid of [null, new Uint8Array(31), new Uint8Array(33)]) {
        assert.deepStrictEqual(
          processSwarmPaymentNotice(received({ txid }), MAINNET),
          { ok: false, refusal: 'malformed' }
        );
      }
    });

    it('is refused without an amount, with zero, or with more than the supply', () => {
      for (const amountZat of [null, 0n, MAX_SWM_ZATOSHI + 1n]) {
        assert.deepStrictEqual(
          processSwarmPaymentNotice(received({ amountZat }), MAINNET),
          { ok: false, refusal: 'malformed' },
          String(amountZat)
        );
      }
      assert.isTrue(
        processSwarmPaymentNotice(
          received({ amountZat: MAX_SWM_ZATOSHI }),
          MAINNET
        ).ok
      );
    });

    it('is refused with a memo hash that is not 32 bytes', () => {
      assert.deepStrictEqual(
        processSwarmPaymentNotice(
          received({ memoHash: new Uint8Array(16) }),
          MAINNET
        ),
        { ok: false, refusal: 'malformed' }
      );
    });

    it('drops a return address that is not shaped like one, not the notice', () => {
      for (const senderAddress of [
        'swm1 with spaces',
        `${MAINNET_ADDRESS}‮`,
        'x'.repeat(SWARM_ADDRESS_MAX_LENGTH + 1),
      ]) {
        const processed = processSwarmPaymentNotice(
          received({ senderAddress }),
          MAINNET
        );
        assert.isTrue(processed.ok);
        if (processed.ok) {
          assert.isNull(processed.event.senderAddress);
        }
      }
    });

    it('trims the note and cuts one that is too long', () => {
      const processed = processSwarmPaymentNotice(
        received({ note: `  ${'n'.repeat(SWARM_NOTE_MAX_LENGTH + 10)}  ` }),
        MAINNET
      );
      assert.isTrue(processed.ok);
      if (processed.ok) {
        assert.strictEqual(processed.event.note?.length, SWARM_NOTE_MAX_LENGTH);
      }
    });

    it('is never built from an event that could not have come from the wallet', () => {
      assert.throws(() => toSwarmDataMessageFields({ ...NOTICE, txid: 'ab' }));
      assert.throws(() =>
        toSwarmDataMessageFields({ ...NOTICE, memoHash: 'cd' })
      );
      assert.throws(() =>
        toSwarmDataMessageFields({ ...NOTICE, amountZat: '0' })
      );
      assert.throws(() =>
        toSwarmDataMessageFields({ ...NOTICE, amountZat: '1.5' })
      );
    });
  });

  describe('an address message', () => {
    it('carries a request, with no address', () => {
      const { payment, swarmAddress } = toSwarmDataMessageFields({
        kind: PaymentEventKind.SwarmAddressRequest,
        chain: 'swarm-mainnet',
      });
      assert.isNull(payment);
      assert.isNotNull(swarmAddress);
      if (swarmAddress == null) {
        return;
      }
      assert.isNull(swarmAddress.address);
      assert.deepStrictEqual(
        processSwarmAddressMessage(receivedAddress(swarmAddress), MAINNET),
        {
          ok: true,
          event: {
            kind: PaymentEventKind.SwarmAddressRequest,
            chain: 'swarm-mainnet',
          },
        }
      );
    });

    it('carries a share, and the address survives exactly', () => {
      const share: SwarmAddressShareEvent = {
        kind: PaymentEventKind.SwarmAddressShare,
        chain: 'swarm-testnet',
        address: TESTNET_ADDRESS,
      };
      const { swarmAddress } = toSwarmDataMessageFields(share);
      assert.isNotNull(swarmAddress);
      if (swarmAddress == null) {
        return;
      }
      assert.deepStrictEqual(
        processSwarmAddressMessage(receivedAddress(swarmAddress), TESTNET),
        { ok: true, event: share }
      );
    });

    it('reads a share whose type was left out as a share', () => {
      assert.deepStrictEqual(
        processSwarmAddressMessage(
          receivedAddress({ address: MAINNET_ADDRESS, chain: 'swarm-mainnet' }),
          MAINNET
        ),
        {
          ok: true,
          event: {
            kind: PaymentEventKind.SwarmAddressShare,
            chain: 'swarm-mainnet',
            address: MAINNET_ADDRESS,
          },
        }
      );
    });

    it('refuses a share with no address, or none shaped like one', () => {
      for (const address of [null, '', '   ', 'swm1 x', 'a'.repeat(513)]) {
        assert.deepStrictEqual(
          processSwarmAddressMessage(
            receivedAddress({
              type: Proto.DataMessage.SwarmAddress.Type.SHARE,
              address,
              chain: 'swarm-mainnet',
            }),
            MAINNET
          ),
          { ok: false, refusal: 'malformed' },
          String(address)
        );
      }
    });

    it('refuses another network and a group', () => {
      const message = receivedAddress({
        type: Proto.DataMessage.SwarmAddress.Type.SHARE,
        address: TESTNET_ADDRESS,
        chain: 'swarm-testnet',
      });
      assert.deepStrictEqual(processSwarmAddressMessage(message, MAINNET), {
        ok: false,
        refusal: 'wrong-chain',
      });
      assert.deepStrictEqual(
        processSwarmAddressMessage(message, { ...TESTNET, inGroup: true }),
        { ok: false, refusal: 'in-group' }
      );
    });
  });
});
