// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReadonlyDeep } from 'type-fest';

import { PaymentEventKind } from '../types/Payment.std.ts';
import type { AnyPaymentEvent } from '../types/Payment.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import type { ReadonlyMessageAttributesType } from '../model-types.d.ts';
import { missingCaseError } from '../util/missingCaseError.std.ts';
import {
  formatZatoshiAsSwm,
  zatoshiFromString,
} from '../util/swarm/swmAmount.std.ts';

export type MessageAttributesWithPaymentEvent = ReadonlyMessageAttributesType &
  ReadonlyDeep<{
    payment: AnyPaymentEvent;
  }>;

export function messageHasPaymentEvent(
  message: ReadonlyMessageAttributesType
): message is MessageAttributesWithPaymentEvent {
  return message.payment != null;
}

export function getPaymentEventNotificationText(
  payment: ReadonlyDeep<AnyPaymentEvent>,
  senderTitle: string,
  conversationTitle: string | null,
  senderIsMe: boolean,
  i18n: LocalizerType
): string {
  if (payment.kind === PaymentEventKind.Notification) {
    return i18n('icu:payment-event-notification-label');
  }
  // SWARM addition (M3 wave 2): a notification, a chat-list preview or a
  // quote says that a payment notice is there, not how much it claims. The
  // amount is shown in the chat, beside what the wallet has seen.
  if (payment.kind === PaymentEventKind.SwarmNotification) {
    return i18n('icu:SwarmChat__notice--label');
  }
  return getPaymentEventDescription(
    payment,
    senderTitle,
    conversationTitle,
    senderIsMe,
    i18n
  );
}

export function getPaymentEventDescription(
  payment: ReadonlyDeep<AnyPaymentEvent>,
  senderTitle: string,
  conversationTitle: string | null,
  senderIsMe: boolean,
  i18n: LocalizerType
): string {
  const { kind } = payment;
  if (kind === PaymentEventKind.Notification) {
    if (senderIsMe) {
      if (conversationTitle != null) {
        return i18n('icu:payment-event-notification-message-you-label', {
          receiver: conversationTitle,
        });
      }
      return i18n(
        'icu:payment-event-notification-message-you-label-without-receiver'
      );
    }
    return i18n('icu:payment-event-notification-message-label', {
      sender: senderTitle,
    });
  }
  if (kind === PaymentEventKind.ActivationRequest) {
    if (senderIsMe) {
      if (conversationTitle != null) {
        return i18n('icu:payment-event-activation-request-you-label', {
          receiver: conversationTitle,
        });
      }
      return i18n(
        'icu:payment-event-activation-request-you-label-without-receiver'
      );
    }
    return i18n('icu:payment-event-activation-request-label', {
      sender: senderTitle,
    });
  }
  if (kind === PaymentEventKind.Activation) {
    if (senderIsMe) {
      return i18n('icu:payment-event-activated-you-label');
    }
    return i18n('icu:payment-event-activated-label', {
      sender: senderTitle,
    });
  }
  // SWARM addition (M3 wave 2). The amount is the notice's own claim, in SWM
  // with all eight decimals; whether it arrived is the wallet's to say, and the
  // bubble says it beside this sentence.
  if (kind === PaymentEventKind.SwarmNotification) {
    const amount = formatZatoshiAsSwm(zatoshiFromString(payment.amountZat));
    if (senderIsMe) {
      if (conversationTitle != null) {
        return i18n('icu:SwarmChat__notice--you', {
          amount,
          receiver: conversationTitle,
        });
      }
      return i18n('icu:SwarmChat__notice--you-without-receiver', { amount });
    }
    return i18n('icu:SwarmChat__notice', { amount, sender: senderTitle });
  }
  if (kind === PaymentEventKind.SwarmAddressRequest) {
    if (senderIsMe) {
      if (conversationTitle != null) {
        return i18n('icu:SwarmChat__request--you', {
          receiver: conversationTitle,
        });
      }
      return i18n('icu:SwarmChat__request--you-without-receiver');
    }
    return i18n('icu:SwarmChat__request', { sender: senderTitle });
  }
  if (kind === PaymentEventKind.SwarmAddressShare) {
    if (senderIsMe) {
      if (conversationTitle != null) {
        return i18n('icu:SwarmChat__share--you', {
          receiver: conversationTitle,
        });
      }
      return i18n('icu:SwarmChat__share--you-without-receiver');
    }
    return i18n('icu:SwarmChat__share', { sender: senderTitle });
  }
  throw missingCaseError(kind);
}
