// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): what the app says about a SWARM payment message,
// in the real English strings. The notice's amount has all eight decimals and
// comes from the notice itself (the wallet's word is said beside it, in the
// bubble); a notification, a chat-list preview or a quote names a payment
// without its amount.

import { assert } from 'chai';

import i18n from '../util/i18n.node.ts';
import {
  getPaymentEventDescription,
  getPaymentEventNotificationText,
} from '../../messages/payments.std.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type { SwarmPaymentEvent } from '../../types/Payment.std.ts';

const NOTICE: SwarmPaymentEvent = {
  kind: PaymentEventKind.SwarmNotification,
  txid: 'aa'.repeat(32),
  amountZat: '123456789',
  memoHash: null,
  chain: 'swarm-mainnet',
  senderAddress: null,
  note: null,
};

describe('SWARM chat payments: sentences', () => {
  it('says what a received notice claims, with eight decimals', () => {
    assert.strictEqual(
      getPaymentEventDescription(NOTICE, 'Ada', 'Ada', false, i18n),
      'Ada sent you 1.23456789 SWM'
    );
  });

  it('says what this device sent', () => {
    assert.strictEqual(
      getPaymentEventDescription(NOTICE, 'You', 'Ada', true, i18n),
      'You sent 1.23456789 SWM to Ada'
    );
    assert.strictEqual(
      getPaymentEventDescription(
        { ...NOTICE, amountZat: '1' },
        'You',
        null,
        true,
        i18n
      ),
      'You sent 0.00000001 SWM'
    );
  });

  it('keeps the amount out of notifications, previews and quotes', () => {
    const text = getPaymentEventNotificationText(
      NOTICE,
      'Ada',
      'Ada',
      false,
      i18n
    );
    assert.strictEqual(text, 'SWARM payment');
    assert.notInclude(text, '1.23456789');
  });

  it('says who asked for an address and who shared one', () => {
    const request: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmAddressRequest,
      chain: 'swarm-mainnet',
    };
    const share: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmAddressShare,
      chain: 'swarm-mainnet',
      address: 'swm1example',
    };
    assert.strictEqual(
      getPaymentEventDescription(request, 'Ada', 'Ada', false, i18n),
      'Ada wants your SWARM address'
    );
    assert.strictEqual(
      getPaymentEventDescription(request, 'You', 'Ada', true, i18n),
      'You asked Ada for their SWARM address'
    );
    assert.strictEqual(
      getPaymentEventDescription(share, 'Ada', 'Ada', false, i18n),
      'Ada shared their SWARM address'
    );
    assert.strictEqual(
      getPaymentEventDescription(share, 'You', 'Ada', true, i18n),
      'You shared your SWARM address with Ada'
    );
    // The address itself is never part of the sentence.
    assert.notInclude(
      getPaymentEventNotificationText(share, 'Ada', 'Ada', false, i18n),
      'swm1example'
    );
  });
});
