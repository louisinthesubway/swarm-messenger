// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): SWARM payments inside a chat, on the renderer's
// side. What a chat does with the wallet, and nothing else:
//
// - ask for an address, share one (a fresh unified address per conversation
//   by default), answer or ignore a request;
// - keep an address somebody shared here - only after the wallet has checked
//   it for its own network - against this conversation;
// - after a payment the wallet has already sent, and only then, tell the other
//   person in an ordinary message (the notice). A lost notice loses the
//   notice, never the money.
//
// Every message goes through the conversation's normal send queue, inside the
// same end-to-end encryption as text. The wallet itself stays in the main
// process; this file only talks to it through ts/services/swarmWallet.preload.ts.
//
// Logging: outcomes by category. Never an address, an amount or a txid.

import type { ConversationModel } from '../models/conversations.preload.ts';
import type { MessageAttributesType } from '../model-types.d.ts';
import { createLogger } from '../logging/log.std.ts';
import { DataWriter } from '../sql/Client.preload.ts';
import { PaymentEventKind, isSwarmPaymentEvent } from '../types/Payment.std.ts';
import type {
  SwarmChainLabel,
  SwarmPaymentEvent,
  SwarmPaymentNotificationEvent,
} from '../types/Payment.std.ts';
import { isSignalConversation } from '../util/isSignalConversation.dom.ts';
import {
  isDirectConversation,
  isMe,
} from '../util/whatTypeOfConversation.dom.ts';
import { isSwarmChainLabel } from '../util/swarm/swarmChatPayments.std.ts';
import {
  ourSwarmAddress,
  reduceSwarmConversation,
} from '../util/swarm/swarmConversation.std.ts';
import type { SwarmConversationActionType } from '../util/swarm/swarmConversation.std.ts';
import { getSwarmWalletChain } from '../util/swarm/swarmWalletChain.dom.ts';
import {
  checkSwarmAddress,
  getSwarmWalletState,
  newSwarmWalletAddress,
} from './swarmWallet.preload.ts';

const log = createLogger('swarmChatPayments');

/**
 * Where SWARM payments are offered in wave 2: a one-to-one chat with another
 * person. Not a group ("the conversation's address" would have many owners),
 * not Note to Self, not the Signal release-notes chat.
 */
export function canUseSwarmPayments(
  conversation: ConversationModel | undefined
): conversation is ConversationModel {
  return (
    conversation != null &&
    isDirectConversation(conversation.attributes) &&
    !isMe(conversation.attributes) &&
    !isSignalConversation(conversation.attributes) &&
    conversation.getServiceId() != null
  );
}

function getConversation(conversationId: string): ConversationModel {
  const conversation = window.ConversationController.get(conversationId);
  if (!canUseSwarmPayments(conversation)) {
    throw new Error('SWARM payments are for one-to-one chats');
  }
  return conversation;
}

async function updateSwarmPayments(
  conversation: ConversationModel,
  action: SwarmConversationActionType
): Promise<void> {
  const current = conversation.get('swarmPayments');
  const next = reduceSwarmConversation(current, action);
  if (next === current) {
    return;
  }
  conversation.set({ swarmPayments: next });
  await DataWriter.updateConversation(conversation.attributes);
}

async function send(
  conversation: ConversationModel,
  swarmPayment: SwarmPaymentEvent
): Promise<MessageAttributesType | undefined> {
  return conversation.enqueueMessageForSend(
    { attachments: [], body: undefined, swarmPayment },
    { timestamp: Date.now(), dontClearDraft: true }
  );
}

// Asking and sharing ------------------------------------------------------------

/** Sends "please send me a SWARM address" for the network the wallet is on. */
export async function requestSwarmAddress(
  conversationId: string
): Promise<void> {
  const conversation = getConversation(conversationId);
  await send(conversation, {
    kind: PaymentEventKind.SwarmAddressRequest,
    chain: getSwarmWalletChain(),
  });
  log.info('requestSwarmAddress: sent');
}

export type SwarmShareProblemType = 'not-ready' | 'offline' | 'rejected';

export type SwarmShareResultType =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; problem: SwarmShareProblemType }>;

/**
 * This conversation's own address on the wallet's network: the one made for
 * it before, or a new one, made now and remembered here.
 */
async function conversationAddress(
  conversation: ConversationModel,
  chain: SwarmChainLabel
): Promise<
  | Readonly<{ ok: true; address: string }>
  | Readonly<{ ok: false; problem: SwarmShareProblemType }>
> {
  const kept = ourSwarmAddress(conversation.get('swarmPayments'), chain);
  if (kept != null) {
    return { ok: true, address: kept.address };
  }
  const made = await newSwarmWalletAddress();
  if (!made.ok) {
    return { ok: false, problem: made.refusal };
  }
  if (made.chain !== chain) {
    // The network changed under us (developer switch): share nothing.
    return { ok: false, problem: 'rejected' };
  }
  await updateSwarmPayments(conversation, {
    type: 'our-address-created',
    chain,
    address: made.address,
    createdAt: Date.now(),
  });
  return { ok: true, address: made.address };
}

/**
 * Shares a SWARM address in this chat. By default it is this conversation's
 * own address (made the first time), so two people cannot link their payments
 * to each other through one address; `perConversation: false` shares the
 * wallet's main address instead. When it answers a request, the request is
 * marked answered.
 */
export async function shareSwarmAddress(
  conversationId: string,
  {
    perConversation,
    answeringMessageId,
  }: { perConversation: boolean; answeringMessageId?: string }
): Promise<SwarmShareResultType> {
  const conversation = getConversation(conversationId);
  const state = await getSwarmWalletState();
  if (state.status === 'offline') {
    return { ok: false, problem: 'offline' };
  }
  if (state.status !== 'ready' || !isSwarmChainLabel(state.network.chain)) {
    return { ok: false, problem: 'not-ready' };
  }
  const chain = state.network.chain;

  let address: string;
  if (perConversation) {
    const own = await conversationAddress(conversation, chain);
    if (!own.ok) {
      log.info(`shareSwarmAddress: no address (${own.problem})`);
      return own;
    }
    address = own.address;
  } else {
    if (state.address == null) {
      return { ok: false, problem: 'not-ready' };
    }
    address = state.address;
  }

  await send(conversation, {
    kind: PaymentEventKind.SwarmAddressShare,
    chain,
    address,
  });
  if (answeringMessageId != null) {
    await updateSwarmPayments(conversation, {
      type: 'request-answered',
      chain,
      messageId: answeringMessageId,
      answer: 'shared',
    });
  }
  log.info(
    `shareSwarmAddress: sent (${perConversation ? 'per-conversation' : 'main'} address)`
  );
  return { ok: true };
}

/** Marks an address request as ignored; nothing is sent. */
export async function ignoreSwarmAddressRequest(
  conversationId: string,
  { messageId, chain }: { messageId: string; chain: SwarmChainLabel }
): Promise<void> {
  const conversation = getConversation(conversationId);
  await updateSwarmPayments(conversation, {
    type: 'request-answered',
    chain,
    messageId,
    answer: 'ignored',
  });
  log.info('ignoreSwarmAddressRequest: ignored');
}

// Paying ------------------------------------------------------------------------

export type SwarmNoticeToSendType = Readonly<{
  txid: string;
  amountZat: string;
  memoHash: string | null;
  chain: SwarmChainLabel;
  includeMyAddress: boolean;
}>;

/**
 * Tells the other person about a payment the wallet has already sent. Called
 * with the wallet's own answer (txid, chain, memo hash), never before it. When
 * the person chose to include their address, it is this conversation's own
 * address; if that cannot be had, the notice goes without it rather than not
 * at all.
 */
export async function sendSwarmPaymentNotice(
  conversationId: string,
  notice: SwarmNoticeToSendType
): Promise<void> {
  const conversation = getConversation(conversationId);

  let senderAddress: string | null = null;
  if (notice.includeMyAddress) {
    const own = await conversationAddress(conversation, notice.chain);
    if (own.ok) {
      senderAddress = own.address;
    } else {
      log.warn(
        `sendSwarmPaymentNotice: sending without a return address (${own.problem})`
      );
    }
  }

  const event: SwarmPaymentNotificationEvent = {
    kind: PaymentEventKind.SwarmNotification,
    txid: notice.txid,
    amountZat: notice.amountZat,
    memoHash: notice.memoHash,
    chain: notice.chain,
    senderAddress,
    note: null,
  };
  const sent = await send(conversation, event);
  if (sent != null) {
    await updateSwarmPayments(conversation, {
      type: 'notice',
      chain: notice.chain,
      txid: notice.txid,
      direction: 'outgoing',
      messageId: sent.id,
    });
  }
  log.info('sendSwarmPaymentNotice: queued');
}

// Receiving ---------------------------------------------------------------------

/**
 * Keeps an address somebody shared here, if the wallet accepts it for its own
 * network. Refused addresses are not kept; the message still shows, and says
 * why when it is looked at.
 */
async function keepTheirAddress(
  conversation: ConversationModel,
  {
    address,
    chain,
    message,
  }: { address: string; chain: SwarmChainLabel; message: MessageAttributesType }
): Promise<void> {
  const check = await checkSwarmAddress(address);
  if (!check.accepted || check.chain !== chain) {
    log.info(
      `keepTheirAddress: not kept (${check.accepted ? 'other network' : 'refused by the wallet'})`
    );
    return;
  }
  await updateSwarmPayments(conversation, {
    type: 'their-address-checked',
    chain,
    address,
    messageId: message.id,
    sentAt: message.sent_at,
  });
  log.info('keepTheirAddress: kept');
}

/**
 * After a SWARM message has been received (handleDataMessage): an address -
 * shared, or a notice's return address - is checked and kept against the
 * conversation, and a notice is remembered so the Wallet pane can say who a
 * transaction was with. The message itself is saved and shown regardless.
 */
export async function onSwarmPaymentEventReceived({
  conversation,
  message,
}: {
  conversation: ConversationModel;
  message: MessageAttributesType;
}): Promise<void> {
  const { payment } = message;
  if (!isSwarmPaymentEvent(payment) || !canUseSwarmPayments(conversation)) {
    return;
  }
  try {
    if (message.type === 'incoming') {
      if (payment.kind === PaymentEventKind.SwarmNotification) {
        await updateSwarmPayments(conversation, {
          type: 'notice',
          chain: payment.chain,
          txid: payment.txid,
          direction: 'incoming',
          messageId: message.id,
        });
        if (payment.senderAddress != null) {
          await keepTheirAddress(conversation, {
            address: payment.senderAddress,
            chain: payment.chain,
            message,
          });
        }
      } else if (payment.kind === PaymentEventKind.SwarmAddressShare) {
        await keepTheirAddress(conversation, {
          address: payment.address,
          chain: payment.chain,
          message,
        });
      }
    } else if (
      message.type === 'outgoing' &&
      payment.kind === PaymentEventKind.SwarmNotification
    ) {
      // A payment this account made from another of its devices.
      await updateSwarmPayments(conversation, {
        type: 'notice',
        chain: payment.chain,
        txid: payment.txid,
        direction: 'outgoing',
        messageId: message.id,
      });
    }
  } catch (error) {
    log.warn(
      `onSwarmPaymentEventReceived: ${error instanceof Error ? error.name : 'error'}`
    );
  }
}
