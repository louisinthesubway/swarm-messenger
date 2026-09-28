// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): what a conversation remembers about SWARM
// payments, and the one function that changes it.
//
// Where it lives: the conversation's own attributes (`swarmPayments`), in this
// device's database only. Not in a profile, not in a contact record: storage
// service syncs a fixed list of fields and this is not one of them, and the
// chat backup leaves SWARM payment messages out. Per network, because an
// address on one SWARM network is useless - and dangerous - on the other.
//
// What it holds:
// - `theirAddress`: the address the other person shared here, kept only after
//   the wallet checked it for this network, with the message it came from, so
//   the send screen can say where the address it pays came from. The newest
//   message wins; an older share that arrives late does not replace it.
// - `ourAddress`: the address this wallet made for this conversation (a fresh
//   unified address per conversation, so two counterparties cannot link their
//   payments to each other through a shared address).
// - `notices`: which transactions this conversation's payment notices named,
//   so the Wallet pane can label a transaction "from Ada".
// - `answeredRequests`: address requests answered here (shared or ignored), so
//   a request stops asking once it has an answer.

import type { SwarmChainLabel } from '../../types/Payment.std.ts';

export type SwarmTheirAddressType = Readonly<{
  address: string;
  /** The message it came from: a share, or a payment notice's return address. */
  messageId: string;
  /** When that message was sent, by the sender's clock (sent_at). */
  sentAt: number;
}>;

export type SwarmOurAddressType = Readonly<{
  address: string;
  createdAt: number;
}>;

export type SwarmNoticeRecordType = Readonly<{
  txid: string;
  direction: 'incoming' | 'outgoing';
  messageId: string;
}>;

export type SwarmRequestAnswerType = 'shared' | 'ignored';

export type SwarmChainConversationStateType = Readonly<{
  theirAddress?: SwarmTheirAddressType;
  ourAddress?: SwarmOurAddressType;
  notices?: ReadonlyArray<SwarmNoticeRecordType>;
  answeredRequests?: Readonly<Record<string, SwarmRequestAnswerType>>;
}>;

export type SwarmConversationStateType = Readonly<
  Partial<Record<SwarmChainLabel, SwarmChainConversationStateType>>
>;

/** How many notices a conversation remembers for the Wallet pane's labels. */
export const MAX_NOTICES_PER_CONVERSATION = 200;

/** How many answered requests a conversation remembers. */
export const MAX_ANSWERED_REQUESTS = 100;

export type SwarmConversationActionType =
  | Readonly<{
      /** An address the other person shared, checked by the wallet. */
      type: 'their-address-checked';
      chain: SwarmChainLabel;
      address: string;
      messageId: string;
      sentAt: number;
    }>
  | Readonly<{
      /** The address this wallet made for this conversation. */
      type: 'our-address-created';
      chain: SwarmChainLabel;
      address: string;
      createdAt: number;
    }>
  | Readonly<{
      /** A payment notice sent or received here. */
      type: 'notice';
      chain: SwarmChainLabel;
      txid: string;
      direction: 'incoming' | 'outgoing';
      messageId: string;
    }>
  | Readonly<{
      type: 'request-answered';
      chain: SwarmChainLabel;
      messageId: string;
      answer: SwarmRequestAnswerType;
    }>;

function withChain(
  state: SwarmConversationStateType | undefined,
  chain: SwarmChainLabel,
  update: (
    current: SwarmChainConversationStateType
  ) => SwarmChainConversationStateType
): SwarmConversationStateType {
  const current = state?.[chain] ?? {};
  const next = update(current);
  if (next === current && state != null) {
    return state;
  }
  return { ...state, [chain]: next };
}

export function reduceSwarmConversation(
  state: SwarmConversationStateType | undefined,
  action: SwarmConversationActionType
): SwarmConversationStateType {
  switch (action.type) {
    case 'their-address-checked':
      return withChain(state, action.chain, current => {
        const kept = current.theirAddress;
        // A later message wins. An older share arriving late (a queued message
        // delivered after a newer one) does not replace what came after it.
        if (kept != null && kept.sentAt > action.sentAt) {
          return current;
        }
        if (
          kept != null &&
          kept.address === action.address &&
          kept.messageId === action.messageId
        ) {
          return current;
        }
        return {
          ...current,
          theirAddress: {
            address: action.address,
            messageId: action.messageId,
            sentAt: action.sentAt,
          },
        };
      });
    case 'our-address-created':
      return withChain(state, action.chain, current => ({
        ...current,
        ourAddress: { address: action.address, createdAt: action.createdAt },
      }));
    case 'notice':
      return withChain(state, action.chain, current => {
        const notices = current.notices ?? [];
        if (
          notices.some(
            notice =>
              notice.txid === action.txid &&
              notice.direction === action.direction
          )
        ) {
          return current;
        }
        return {
          ...current,
          notices: [
            ...notices,
            {
              txid: action.txid,
              direction: action.direction,
              messageId: action.messageId,
            },
          ].slice(-MAX_NOTICES_PER_CONVERSATION),
        };
      });
    case 'request-answered':
      return withChain(state, action.chain, current => {
        const answered = current.answeredRequests ?? {};
        if (answered[action.messageId] === action.answer) {
          return current;
        }
        const entries = Object.entries(answered).filter(
          ([messageId]) => messageId !== action.messageId
        );
        entries.push([action.messageId, action.answer]);
        return {
          ...current,
          answeredRequests: Object.fromEntries(
            entries.slice(-MAX_ANSWERED_REQUESTS)
          ),
        };
      });
    default:
      throw new Error('reduceSwarmConversation: unknown action');
  }
}

/** The checked address the other person shared on this network, if any. */
export function theirSwarmAddress(
  state: SwarmConversationStateType | undefined,
  chain: SwarmChainLabel
): SwarmTheirAddressType | undefined {
  return state?.[chain]?.theirAddress;
}

/** This conversation's own address on this network, if one was made. */
export function ourSwarmAddress(
  state: SwarmConversationStateType | undefined,
  chain: SwarmChainLabel
): SwarmOurAddressType | undefined {
  return state?.[chain]?.ourAddress;
}

/** How an address request was answered here, if it was. */
export function swarmRequestAnswer(
  state: SwarmConversationStateType | undefined,
  chain: SwarmChainLabel,
  messageId: string
): SwarmRequestAnswerType | undefined {
  return state?.[chain]?.answeredRequests?.[messageId];
}
