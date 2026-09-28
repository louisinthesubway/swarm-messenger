// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

export enum PaymentEventKind {
  Notification = 1,
  ActivationRequest = 2,
  Activation = 3,
  // Request = 4, -- disabled
  // Cancellation = 5, -- disabled

  // SWARM addition (M3 wave 2). Numbered well apart from upstream's kinds: the
  // kind is stored with the message, and a kind upstream adds later must not
  // read a SWARM notice as something else.
  SwarmNotification = 101,
  SwarmAddressRequest = 102,
  SwarmAddressShare = 103,
}

export type PaymentNotificationEvent = Readonly<{
  kind: PaymentEventKind.Notification;
  note: string | null;

  // Backup related data
  transactionDetailsBase64?: string;
  amountMob?: string;
  feeMob?: string;
}>;

export type PaymentActivationRequestEvent = Readonly<{
  kind: PaymentEventKind.ActivationRequest;
}>;

export type PaymentActivatedEvent = Readonly<{
  kind: PaymentEventKind.Activation;
}>;

// SWARM addition (M3 wave 2) ------------------------------------------------------
//
// SWARM's in-chat payment messages, stored on the message as `payment` exactly
// as upstream stores its own payment events, so they survive a restart in the
// message's JSON with no new column. Every field is a string or null: a bigint
// cannot be put in the redux store.

/** The two SWARM networks, by the chain label their light servers report. */
export type SwarmChainLabel = 'swarm-mainnet' | 'swarm-testnet';

/**
 * "I have paid you": a SWARM payment that already happened on-chain. It is a
 * claim until the recipient's own wallet finds `txid`; a notice alone is never
 * shown as money received.
 */
export type SwarmPaymentNotificationEvent = Readonly<{
  kind: PaymentEventKind.SwarmNotification;
  /** 64 lowercase hex digits, as the explorer prints it. */
  txid: string;
  /** What the sender says was paid, zatoshi as a decimal string. */
  amountZat: string;
  /** SHA-256 of the on-chain memo, 64 lowercase hex digits, or null: no memo. */
  memoHash: string | null;
  chain: SwarmChainLabel;
  /** The sender's address, for paying back, if they chose to include it. */
  senderAddress: string | null;
  note: string | null;
}>;

/** "Please send me a SWARM address." Nothing is shared automatically. */
export type SwarmAddressRequestEvent = Readonly<{
  kind: PaymentEventKind.SwarmAddressRequest;
  chain: SwarmChainLabel;
}>;

/** "Here is my SWARM address", checked by the wallet before it is kept. */
export type SwarmAddressShareEvent = Readonly<{
  kind: PaymentEventKind.SwarmAddressShare;
  chain: SwarmChainLabel;
  address: string;
}>;

export type SwarmPaymentEvent =
  | SwarmPaymentNotificationEvent
  | SwarmAddressRequestEvent
  | SwarmAddressShareEvent;

export type AnyPaymentEvent =
  | PaymentNotificationEvent
  | PaymentActivationRequestEvent
  | PaymentActivatedEvent
  | SwarmPaymentEvent;

export function isPaymentNotificationEvent(
  event: AnyPaymentEvent
): event is PaymentNotificationEvent {
  return event.kind === PaymentEventKind.Notification;
}

// SWARM addition (M3 wave 2).
export function isSwarmPaymentEvent(
  event: Readonly<{ kind: PaymentEventKind }> | null | undefined
): event is SwarmPaymentEvent {
  return (
    event != null &&
    (event.kind === PaymentEventKind.SwarmNotification ||
      event.kind === PaymentEventKind.SwarmAddressRequest ||
      event.kind === PaymentEventKind.SwarmAddressShare)
  );
}

// SWARM addition (M3 wave 2).
export function isSwarmPaymentNotificationEvent(
  event: Readonly<{ kind: PaymentEventKind }> | null | undefined
): event is SwarmPaymentNotificationEvent {
  return event?.kind === PaymentEventKind.SwarmNotification;
}
