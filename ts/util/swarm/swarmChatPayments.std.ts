// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): SWARM payments inside a chat, on the message
// side. Two things cross in the app's own end-to-end encrypted DataMessage:
//
//   DataMessage.payment.swarmNotification   "I have paid you": txid, amount,
//                                            memo hash, chain, and optionally
//                                            the sender's address
//   DataMessage.swarmAddress                "please send me an address" /
//                                            "here is my address"
//
// This file turns the received protobuf into the event that is stored with the
// message, refusing what must not be shown, and turns an event back into the
// protobuf for sending. Pure functions, so the tests hold every rule:
//
// - a notice or an address for another SWARM network is refused, not shown: a
//   testnet notice and a mainnet notice would otherwise be the same bytes;
// - SWARM items in a group message are refused: in wave 2 an address and a
//   payment belong to a one-to-one chat, where "the conversation's address" has
//   exactly one owner;
// - a notice without a 32-byte txid or a positive amount is refused;
// - an address that is not even shaped like one is refused here, and one that is
//   shaped like one is still checked by the wallet (main process) before the
//   app keeps it.
//
// Nothing here decides that money arrived. That is the recipient's wallet's
// answer alone (swarmNoticeBinding.std.ts).

import * as Bytes from '../../Bytes.std.ts';
import { SignalService as Proto } from '../../protobuf/index.std.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type {
  SwarmAddressRequestEvent,
  SwarmAddressShareEvent,
  SwarmChainLabel,
  SwarmPaymentEvent,
  SwarmPaymentNotificationEvent,
} from '../../types/Payment.std.ts';
import { MAX_SWM_ZATOSHI } from './swmAmount.std.ts';

/** The chain labels of the two SWARM networks, as swarm-wallet-core names them. */
export const SWARM_CHAIN_LABELS: ReadonlyArray<SwarmChainLabel> = [
  'swarm-mainnet',
  'swarm-testnet',
];

export function isSwarmChainLabel(value: unknown): value is SwarmChainLabel {
  return value === 'swarm-mainnet' || value === 'swarm-testnet';
}

/**
 * The block explorer of each network, ending in a slash; transactions are at
 * `<explorer>transactions/<txid>`. The same two the wallet uses
 * (walletIpc.node.ts), checked by hand on 2026-09-27.
 */
export function swarmExplorerFor(chain: SwarmChainLabel): string {
  return chain === 'swarm-mainnet'
    ? 'https://mainnet.explore.swarm.green/'
    : 'https://explore.swarm.green/';
}

/**
 * The longest address taken from a message. A SWARM unified address with an
 * Orchard and a Sapling receiver is about 190 characters; this leaves room for
 * one with every receiver and refuses anything that could only be abuse.
 */
export const SWARM_ADDRESS_MAX_LENGTH = 512;

/** The longest note kept from a notice; the rest is cut. */
export const SWARM_NOTE_MAX_LENGTH = 1024;

/** A txid, a memo hash: 64 lowercase hex digits. */
const HEX_32_BYTES = /^[0-9a-f]{64}$/;

/**
 * Bech32m (unified, sapling, TEX) and Base58Check (transparent) addresses are
 * letters and digits only. This is a shape check, not a check: the wallet
 * checks the checksum and the network before an address is kept.
 */
const ADDRESS_SHAPE = /^[0-9A-Za-z]+$/;

export type SwarmRefusalType =
  /** A required field is missing or of the wrong shape. */
  | 'malformed'
  /** For the other SWARM network, or for none this app knows. */
  | 'wrong-chain'
  /** SWARM payments and addresses are for one-to-one chats. */
  | 'in-group';

export type SwarmProcessedType<T> =
  | Readonly<{ ok: true; event: T }>
  | Readonly<{ ok: false; refusal: SwarmRefusalType }>;

export type SwarmReceiveContextType = Readonly<{
  /** The network this app's wallet is on. */
  walletChain: SwarmChainLabel;
  /** True when the message was sent to a group. */
  inGroup: boolean;
}>;

function refuse<T>(refusal: SwarmRefusalType): SwarmProcessedType<T> {
  return { ok: false, refusal };
}

/** An address from a message, trimmed, or undefined when it is not one. */
export function readSwarmAddressText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    trimmed === '' ||
    trimmed.length > SWARM_ADDRESS_MAX_LENGTH ||
    !ADDRESS_SHAPE.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

function readNote(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed.length > SWARM_NOTE_MAX_LENGTH
    ? trimmed.slice(0, SWARM_NOTE_MAX_LENGTH)
    : trimmed;
}

/**
 * A received `Payment.SwarmNotification`, as the event stored with the message,
 * or the reason it is refused.
 */
export function processSwarmPaymentNotice(
  notice: Readonly<Proto.DataMessage.Payment.SwarmNotification>,
  { walletChain, inGroup }: SwarmReceiveContextType
): SwarmProcessedType<SwarmPaymentNotificationEvent> {
  if (inGroup) {
    return refuse('in-group');
  }
  if (!isSwarmChainLabel(notice.chain) || notice.chain !== walletChain) {
    return refuse('wrong-chain');
  }

  const { txid, amountZat, memoHash } = notice;
  if (txid == null || txid.byteLength !== 32) {
    return refuse('malformed');
  }
  if (amountZat == null || amountZat <= 0n || amountZat > MAX_SWM_ZATOSHI) {
    return refuse('malformed');
  }
  let memoHashHex: string | null = null;
  if (memoHash != null && memoHash.byteLength > 0) {
    if (memoHash.byteLength !== 32) {
      return refuse('malformed');
    }
    memoHashHex = Bytes.toHex(memoHash);
  }

  return {
    ok: true,
    event: {
      kind: PaymentEventKind.SwarmNotification,
      txid: Bytes.toHex(txid),
      amountZat: amountZat.toString(),
      memoHash: memoHashHex,
      chain: notice.chain,
      // A return address that is not even shaped like one is dropped, not the
      // notice: the payment it describes happened either way.
      senderAddress: readSwarmAddressText(notice.senderAddress) ?? null,
      note: readNote(notice.note),
    },
  };
}

/**
 * A received `DataMessage.SwarmAddress`, as the event stored with the message,
 * or the reason it is refused.
 */
export function processSwarmAddressMessage(
  message: Readonly<Proto.DataMessage.SwarmAddress>,
  { walletChain, inGroup }: SwarmReceiveContextType
): SwarmProcessedType<SwarmAddressRequestEvent | SwarmAddressShareEvent> {
  if (inGroup) {
    return refuse('in-group');
  }
  if (!isSwarmChainLabel(message.chain) || message.chain !== walletChain) {
    return refuse('wrong-chain');
  }

  if (message.type === Proto.DataMessage.SwarmAddress.Type.REQUEST) {
    return {
      ok: true,
      event: {
        kind: PaymentEventKind.SwarmAddressRequest,
        chain: message.chain,
      },
    };
  }

  // SHARE is the zero value; an encoder may leave it out, so an absent type
  // with an address is a share too.
  if (
    message.type != null &&
    message.type !== Proto.DataMessage.SwarmAddress.Type.SHARE
  ) {
    return refuse('malformed');
  }
  const address = readSwarmAddressText(message.address);
  if (address == null) {
    return refuse('malformed');
  }
  return {
    ok: true,
    event: {
      kind: PaymentEventKind.SwarmAddressShare,
      chain: message.chain,
      address,
    },
  };
}

export type SwarmDataMessageFieldsType = Readonly<{
  payment: Proto.DataMessage.Payment.Params | null;
  swarmAddress: Proto.DataMessage.SwarmAddress.Params | null;
}>;

/**
 * The DataMessage fields that carry a SWARM event, for sending. Throws on an
 * event that could not have come from this app, rather than sending it.
 */
export function toSwarmDataMessageFields(
  event: SwarmPaymentEvent
): SwarmDataMessageFieldsType {
  switch (event.kind) {
    case PaymentEventKind.SwarmNotification: {
      if (!HEX_32_BYTES.test(event.txid)) {
        throw new Error('toSwarmDataMessageFields: txid is not 32 bytes');
      }
      if (event.memoHash != null && !HEX_32_BYTES.test(event.memoHash)) {
        throw new Error('toSwarmDataMessageFields: memoHash is not 32 bytes');
      }
      if (!/^[1-9][0-9]{0,18}$/.test(event.amountZat)) {
        throw new Error('toSwarmDataMessageFields: amount is not zatoshi');
      }
      return {
        payment: {
          Item: {
            swarmNotification: {
              txid: Bytes.fromHex(event.txid),
              amountZat: BigInt(event.amountZat),
              memoHash:
                event.memoHash == null ? null : Bytes.fromHex(event.memoHash),
              senderAddress: event.senderAddress,
              chain: event.chain,
              note: event.note,
            },
          },
        },
        swarmAddress: null,
      };
    }
    case PaymentEventKind.SwarmAddressRequest:
      return {
        payment: null,
        swarmAddress: {
          type: Proto.DataMessage.SwarmAddress.Type.REQUEST,
          address: null,
          chain: event.chain,
        },
      };
    case PaymentEventKind.SwarmAddressShare:
      return {
        payment: null,
        swarmAddress: {
          type: Proto.DataMessage.SwarmAddress.Type.SHARE,
          address: event.address,
          chain: event.chain,
        },
      };
    default:
      throw new Error('toSwarmDataMessageFields: not a SWARM event');
  }
}
