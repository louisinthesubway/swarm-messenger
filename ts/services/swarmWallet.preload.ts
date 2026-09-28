// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): the Wallet pane's side of the wallet's IPC
// surface. A thin, typed client: no wallet code, no key, no seed. Every answer
// from the main process is parsed with the same schemas the main process
// writes with, so a mismatch is an error here rather than a blank pane.

import { ipcRenderer } from 'electron';
import * as z from 'zod';

import { toBase64 } from '../Bytes.std.ts';
import { signalProtocolStore } from '../SignalProtocolStore.preload.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { parseUnknown } from '../util/schemas.std.ts';
import { noteSwarmWalletChain } from '../util/swarm/swarmWalletChain.dom.ts';
import {
  CheckAddressResultSchema,
  ConfirmSendResultSchema,
  FindTransactionResultSchema,
  NewAddressResultSchema,
  QuoteSendResultSchema,
  SWARM_WALLET_CHANNEL,
  SwarmWalletProblemSchema,
  SwarmWalletStateSchema,
} from '../types/SwarmWallet.std.ts';
import type {
  CheckAddressResultType,
  ConfirmSendResultType,
  FindTransactionResultType,
  NewAddressResultType,
  QuoteSendResultType,
  SwarmWalletNetworkIdType,
  SwarmWalletProblemType,
  SwarmWalletStateType,
} from '../types/SwarmWallet.std.ts';

const OpenWithPhraseResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), state: SwarmWalletStateSchema }),
  z.object({ ok: z.literal(false), problem: SwarmWalletProblemSchema }),
]);

export type OpenWithPhraseResultType =
  | Readonly<{ ok: true; state: SwarmWalletStateType }>
  | Readonly<{ ok: false; problem: SwarmWalletProblemType }>;

/**
 * The signed-in account's identity public key, which is what names its wallet.
 * Public: it is in every message the account has ever sent. Undefined before
 * registration.
 */
function getAccountKey(): string | undefined {
  const aci = itemStorage.user.getAci();
  if (aci == null) {
    return undefined;
  }
  const keyPair = signalProtocolStore.getIdentityKeyPair(aci);
  if (keyPair == null) {
    return undefined;
  }
  return toBase64(keyPair.publicKey.serialize());
}

/**
 * SWARM change (M3 wave 2): every state the renderer receives says which
 * network the wallet is on, and payment notices are held to that network.
 */
function parseState(answer: unknown): SwarmWalletStateType {
  const state = parseUnknown(SwarmWalletStateSchema, answer);
  noteSwarmWalletChain(state.network.chain);
  return state;
}

export async function getSwarmWalletState(): Promise<SwarmWalletStateType> {
  const accountKey = getAccountKey();
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.getState,
    accountKey == null ? {} : { accountKey }
  );
  return parseState(answer);
}

/**
 * Opens the wallet from its recovery phrase. From the Wallet pane the phrase
 * must belong to the signed-in account; at sign-in there is no account yet and
 * the phrase defines it.
 *
 * The phrase goes to the main process once and is not kept here.
 */
export async function openSwarmWalletWithPhrase({
  phrase,
  isNewPhrase,
  forSignedInAccount,
}: {
  phrase: string;
  isNewPhrase: boolean;
  forSignedInAccount: boolean;
}): Promise<OpenWithPhraseResultType> {
  const accountKey = forSignedInAccount ? getAccountKey() : undefined;
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.openWithPhrase,
    accountKey == null
      ? { phrase, isNewPhrase }
      : { phrase, isNewPhrase, accountKey }
  );
  const result = parseUnknown(OpenWithPhraseResultSchema, answer);
  if (result.ok) {
    noteSwarmWalletChain(result.state.network.chain);
  }
  return result;
}

export async function refreshSwarmWallet(): Promise<SwarmWalletStateType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.refresh
  );
  return parseState(answer);
}

export async function quoteSwarmWalletSend(request: {
  to: string;
  amount: string;
  memo: string;
}): Promise<QuoteSendResultType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.quoteSend,
    request.memo === '' ? { to: request.to, amount: request.amount } : request
  );
  return parseUnknown(QuoteSendResultSchema, answer);
}

export async function confirmSwarmWalletSend(
  quoteId: string
): Promise<ConfirmSendResultType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.confirmSend,
    { quoteId }
  );
  return parseUnknown(ConfirmSendResultSchema, answer);
}

export async function cancelSwarmWalletSend(): Promise<void> {
  await ipcRenderer.invoke(SWARM_WALLET_CHANNEL.cancelSend);
}

export async function setSwarmWalletNetwork(
  network: SwarmWalletNetworkIdType
): Promise<SwarmWalletStateType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.setNetwork,
    { network }
  );
  return parseState(answer);
}

// SWARM addition (M3 wave 2): payments inside a chat -----------------------------

/** A new address of this wallet, for one conversation. */
export async function newSwarmWalletAddress(): Promise<NewAddressResultType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.newAddress,
    {}
  );
  return parseUnknown(NewAddressResultSchema, answer);
}

/** The wallet's check of an address somebody shared, for its own network. */
export async function checkSwarmAddress(
  address: string
): Promise<CheckAddressResultType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.checkAddress,
    { address }
  );
  return parseUnknown(CheckAddressResultSchema, answer);
}

/**
 * What this wallet knows about the transaction a payment notice names. The one
 * source of "received": the notice's own amount is never used for it.
 */
export async function findSwarmTransaction({
  txid,
  memoHash,
}: {
  txid: string;
  memoHash: string | null;
}): Promise<FindTransactionResultType> {
  const accountKey = getAccountKey();
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_WALLET_CHANNEL.findTransaction,
    {
      txid,
      ...(memoHash == null ? {} : { memoHash }),
      ...(accountKey == null ? {} : { accountKey }),
    }
  );
  const result = parseUnknown(FindTransactionResultSchema, answer);
  noteSwarmWalletChain(result.chain);
  return result;
}
