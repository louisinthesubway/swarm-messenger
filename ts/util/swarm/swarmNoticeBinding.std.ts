// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): what a payment notice in a chat may say, from what
// the wallet knows about its transaction.
//
// The rule this file exists for: a notice alone is never shown as money
// received. "Received" comes from the recipient's own wallet having found the
// transaction the notice names, in a block, with value to this wallet - and the
// amount shown is the wallet's, not the notice's. Until then the notice is a
// claim, and says so: "X SWM sent to you - waiting for your wallet to see it".
// Otherwise the message channel would be a way to claim a payment that never
// happened.

import type { SwarmPaymentNotificationEvent } from '../../types/Payment.std.ts';
import type {
  FindTransactionResultType,
  MemoVerdictType,
} from '../../types/SwarmWallet.std.ts';

export type SwarmNoticeViewType =
  // A notice received here -------------------------------------------------
  /** Not found by this wallet (yet). The amount is the notice's claim. */
  | Readonly<{
      state: 'waiting';
      claimedZat: string;
      /** The wallet is not open, so it cannot look. */
      walletClosed: boolean;
    }>
  /** The wallet sees the transaction, not yet in a block. */
  | Readonly<{
      state: 'seen';
      walletZat: string;
      memo: MemoVerdictType;
      memoText: string | null;
    }>
  /** In a block, with value to this wallet: received. */
  | Readonly<{
      state: 'received';
      walletZat: string;
      /** When the notice claimed another amount, what it claimed. */
      claimedZat: string | null;
      blockHeight: number | null;
      memo: MemoVerdictType;
      memoText: string | null;
    }>
  /** The wallet knows the transaction and received nothing in it. */
  | Readonly<{ state: 'not-to-you' }>
  // A notice this account sent ---------------------------------------------
  | Readonly<{ state: 'sent-unlisted' }>
  | Readonly<{ state: 'sent-waiting' }>
  | Readonly<{ state: 'sent-confirmed'; blockHeight: number | null }>
  | Readonly<{ state: 'sent-failed' }>;

/** Whether a view can still change, i.e. whether to keep asking the wallet. */
export function isSwarmNoticeSettled(view: SwarmNoticeViewType): boolean {
  return (
    view.state === 'received' ||
    view.state === 'not-to-you' ||
    view.state === 'sent-confirmed' ||
    view.state === 'sent-failed'
  );
}

export function bindSwarmNotice(
  notice: SwarmPaymentNotificationEvent,
  direction: 'incoming' | 'outgoing',
  lookup: FindTransactionResultType | undefined
): SwarmNoticeViewType {
  // A wallet on another network cannot have seen this transaction.
  const usable = lookup != null && lookup.chain === notice.chain;

  if (direction === 'outgoing') {
    if (!usable || lookup.status !== 'found') {
      return { state: 'sent-unlisted' };
    }
    if (lookup.failed) {
      return { state: 'sent-failed' };
    }
    if (lookup.confirmed) {
      return { state: 'sent-confirmed', blockHeight: lookup.blockHeight };
    }
    return { state: 'sent-waiting' };
  }

  if (!usable || lookup.status !== 'found') {
    return {
      state: 'waiting',
      claimedZat: notice.amountZat,
      walletClosed: lookup?.status === 'wallet-not-ready',
    };
  }
  if (BigInt(lookup.receivedZat) === 0n) {
    return { state: 'not-to-you' };
  }
  if (!lookup.confirmed) {
    return {
      state: 'seen',
      walletZat: lookup.receivedZat,
      memo: lookup.memo,
      memoText: lookup.memoText,
    };
  }
  return {
    state: 'received',
    walletZat: lookup.receivedZat,
    claimedZat:
      lookup.receivedZat === notice.amountZat ? null : notice.amountZat,
    blockHeight: lookup.blockHeight,
    memo: lookup.memo,
    memoText: lookup.memoText,
  };
}
