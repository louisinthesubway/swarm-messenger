// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): the main process's half of the wallet's IPC
// surface, as pure functions so the tests can hold every rule in place.
//
// Everything the renderer sends is `unknown` until a function here has read it.
// The renderer is treated as a caller that may be wrong - a bug, an old build,
// a compromised page - so each value is parsed exactly once, here, and nothing
// the renderer says is used as a path, a server, a key or a chain.

import { createHash } from 'node:crypto';

import {
  SWARM_MAINNET_PROFILE,
  SWARM_TESTNET_PROFILE,
  checkAddressForProfile,
} from 'swarm-wallet-core';
import type { SwarmNetworkProfile } from 'swarm-wallet-core';

import { checkRecoveryPhrase } from './bip39.node.ts';
import { BIP39_ENGLISH_WORDLIST } from './bip39Wordlist.std.ts';
import { deriveWalletIdentity } from './walletIdentity.node.ts';
import { parseSwmAmount } from './swmAmount.std.ts';
import {
  CheckAddressRequestSchema,
  ConfirmSendRequestSchema,
  FindTransactionRequestSchema,
  GetStateRequestSchema,
  NewAddressRequestSchema,
  OpenWithPhraseRequestSchema,
  QuoteSendRequestSchema,
  SetNetworkRequestSchema,
} from '../../types/SwarmWallet.std.ts';
import type {
  CheckAddressResultType,
  FindTransactionResultType,
  MemoVerdictType,
  SendRefusalKindType,
  SendRefusalType,
  SwarmWalletNetworkIdType,
  SwarmWalletNetworkType,
  SwarmWalletProblemType,
} from '../../types/SwarmWallet.std.ts';
import type { FoundTransferType } from '../../workers/swarmWalletProtocol.std.ts';

// Networks ---------------------------------------------------------------------

export type SwarmWalletNetworkDefinitionType = Readonly<{
  profile: SwarmNetworkProfile;
  /** The block explorer; transactions are at `<explorer>transactions/<txid>`. */
  explorer: string;
}>;

/**
 * The two networks the pane can be on. The chain rules - address prefixes,
 * genesis, default light server - are swarm-wallet-core's; the explorers were
 * checked by hand on 2026-09-27: /transactions/<txid> answers 200 on both, and
 * /tx/<txid> answers 404 on both.
 */
export const SWARM_WALLET_NETWORKS: Readonly<
  Record<SwarmWalletNetworkIdType, SwarmWalletNetworkDefinitionType>
> = {
  mainnet: {
    profile: SWARM_MAINNET_PROFILE,
    explorer: 'https://mainnet.explore.swarm.green/',
  },
  testnet: {
    profile: SWARM_TESTNET_PROFILE,
    explorer: 'https://explore.swarm.green/',
  },
};

/** A light server URL a developer setting may point the wallet at, or undefined. */
export function parseServerOverride(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) {
      return undefined;
    }
    return `https://${url.host}`;
  } catch {
    return undefined;
  }
}

/** What the pane is told about the network, host:port and nothing more. */
export function describeNetwork(
  id: SwarmWalletNetworkIdType,
  server: string
): SwarmWalletNetworkType {
  const { profile, explorer } = SWARM_WALLET_NETWORKS[id];
  let host = server;
  try {
    const url = new URL(server);
    host = url.port ? `${url.hostname}:${url.port}` : `${url.hostname}:443`;
  } catch {
    // Leave it as given: it came from this process's own settings.
  }
  return { id, chain: profile.chainLabel, server: host, explorer };
}

// The account, and which wallet file is its -----------------------------------

const WALLET_FILE_LABEL = 'SWARM-Messenger-wallet-file-v1';

/**
 * The file name of an account's wallet, from the account's identity public
 * key: `wallet-<32 hex digits>.dat`. A digest rather than the key itself, so a
 * directory listing does not carry the key; per account, so one person's two
 * accounts on one computer never share a wallet file.
 */
export function walletFileNameFor(accountKey: Uint8Array<ArrayBuffer>): string {
  const digest = createHash('sha256')
    .update(WALLET_FILE_LABEL)
    .update(accountKey)
    .digest('hex');
  return `wallet-${digest.slice(0, 32)}.dat`;
}

/**
 * The account's ACI identity public key for a recovery phrase - the same
 * derivation sign-in used, so the same words always name the same account.
 */
export function accountKeyForPhrase(phrase: string): Uint8Array<ArrayBuffer> {
  return deriveWalletIdentity(phrase).aciKeyPair.publicKey.serialize();
}

export function accountKeyFromBase64(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function sameAccountKey(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>
): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}

// Requests ----------------------------------------------------------------------

export type GetStateInputType = Readonly<{
  accountKey: Uint8Array<ArrayBuffer> | undefined;
}>;

export function parseGetStateRequest(
  input: unknown
): GetStateInputType | undefined {
  const parsed = GetStateRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return undefined;
  }
  return {
    accountKey:
      parsed.data.accountKey == null
        ? undefined
        : accountKeyFromBase64(parsed.data.accountKey),
  };
}

export type OpenWithPhraseInputType =
  | Readonly<{
      ok: true;
      phrase: string;
      isNewPhrase: boolean;
      accountKey: Uint8Array<ArrayBuffer>;
    }>
  | Readonly<{ ok: false; problem: SwarmWalletProblemType }>;

/**
 * A recovery phrase, checked, and the account it belongs to. When the renderer
 * names the account it expects, a phrase for any other account is refused:
 * the pane only ever opens the wallet of the account that is signed in.
 */
export function parseOpenWithPhraseRequest(
  input: unknown
): OpenWithPhraseInputType {
  const parsed = OpenWithPhraseRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problem: 'invalid-phrase' };
  }
  const check = checkRecoveryPhrase(parsed.data.phrase);
  if (!check.valid) {
    return { ok: false, problem: 'invalid-phrase' };
  }
  const accountKey = accountKeyForPhrase(check.phrase);
  if (
    parsed.data.accountKey != null &&
    !sameAccountKey(accountKey, accountKeyFromBase64(parsed.data.accountKey))
  ) {
    return { ok: false, problem: 'wrong-phrase' };
  }
  return {
    ok: true,
    phrase: check.phrase,
    isNewPhrase: parsed.data.isNewPhrase,
    accountKey,
  };
}

/** The shielded memo field: 512 bytes of UTF-8. */
export const MEMO_MAX_BYTES = 512;

export type ValidSendType = Readonly<{
  to: string;
  amountZat: bigint;
  memo: string | null;
}>;

export type ValidatedSendType =
  | Readonly<{ ok: true; send: ValidSendType }>
  | Readonly<{ ok: false; refusal: SendRefusalType }>;

export function refusal(
  kind: SendRefusalKindType,
  {
    detail = null,
    needZat = null,
    haveZat = null,
  }: {
    detail?: string | null;
    needZat?: bigint | null;
    haveZat?: bigint | null;
  } = {}
): SendRefusalType {
  return {
    kind,
    detail,
    needZat: needZat == null ? null : needZat.toString(),
    haveZat: haveZat == null ? null : haveZat.toString(),
  };
}

/**
 * A payment as the renderer asked for it, checked against the network the
 * wallet is on and against what the wallet can spend.
 *
 * - the address must be this network's: a testnet `swarm1…` on mainnet, a
 *   Zcash `u1…`, a damaged checksum - each is refused with the wallet's own
 *   sentence saying which network the address belongs to;
 * - the amount is read as SWM text, exactly, into zatoshi;
 * - a memo is at most 512 bytes, and a transparent address cannot carry one;
 * - an amount above what is spendable is refused here, before any quote.
 *
 * `spendableZat` null means the wallet has not reported a balance yet.
 */
export function validateSendRequest(
  input: unknown,
  profile: SwarmNetworkProfile,
  spendableZat: bigint | null
): ValidatedSendType {
  const parsed = QuoteSendRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, refusal: refusal('rejected') };
  }

  const to = parsed.data.to.trim();
  const verdict = checkAddressForProfile(to, profile);
  if (!verdict.accepted) {
    return {
      ok: false,
      refusal: refusal('invalid-address', { detail: verdict.message }),
    };
  }

  const amount = parseSwmAmount(parsed.data.amount);
  if (!amount.ok) {
    return {
      ok: false,
      refusal: refusal('invalid-amount', { detail: amount.problem }),
    };
  }

  const memo =
    parsed.data.memo == null || parsed.data.memo === ''
      ? null
      : parsed.data.memo;
  if (memo != null) {
    if (Buffer.byteLength(memo, 'utf8') > MEMO_MAX_BYTES) {
      return {
        ok: false,
        refusal: refusal('invalid-memo', { detail: 'too-long' }),
      };
    }
    if (profile.transparentPrefixes.some(prefix => to.startsWith(prefix))) {
      return {
        ok: false,
        refusal: refusal('invalid-memo', { detail: 'transparent' }),
      };
    }
  }

  if (spendableZat == null) {
    return { ok: false, refusal: refusal('not-ready') };
  }
  if (amount.zatoshi > spendableZat) {
    return {
      ok: false,
      refusal: refusal('insufficient-funds', {
        needZat: amount.zatoshi,
        haveZat: spendableZat,
      }),
    };
  }

  return { ok: true, send: { to, amountZat: amount.zatoshi, memo } };
}

export function parseConfirmSendRequest(input: unknown): string | undefined {
  const parsed = ConfirmSendRequestSchema.safeParse(input);
  return parsed.success ? parsed.data.quoteId : undefined;
}

export function parseSetNetworkRequest(
  input: unknown
): SwarmWalletNetworkIdType | undefined {
  const parsed = SetNetworkRequestSchema.safeParse(input);
  return parsed.success ? parsed.data.network : undefined;
}

// Payments inside a chat (M3 wave 2) ---------------------------------------------

/** `swarm-wallet:new-address` carries nothing; anything else is refused. */
export function parseNewAddressRequest(input: unknown): boolean {
  return NewAddressRequestSchema.safeParse(input ?? {}).success;
}

/** The address to check, trimmed, or undefined for a malformed request. */
export function parseCheckAddressRequest(input: unknown): string | undefined {
  const parsed = CheckAddressRequestSchema.safeParse(input);
  return parsed.success ? parsed.data.address.trim() : undefined;
}

/**
 * The wallet's own check of an address for the network it is on - bech32m
 * checksum, human-readable part, the other SWARM network and Zcash refused -
 * as the chat needs it before it keeps an address somebody shared.
 */
export function checkAddressFor(
  address: string,
  network: SwarmWalletNetworkIdType
): CheckAddressResultType {
  const { profile } = SWARM_WALLET_NETWORKS[network];
  const verdict = checkAddressForProfile(address, profile);
  return {
    accepted: verdict.accepted,
    chain: chainLabelOf(network),
    detail: verdict.accepted ? null : verdict.message,
  };
}

export function chainLabelOf(
  network: SwarmWalletNetworkIdType
): 'swarm-mainnet' | 'swarm-testnet' {
  return network === 'mainnet' ? 'swarm-mainnet' : 'swarm-testnet';
}

export type FindTransactionInputType = Readonly<{
  txid: string;
  memoHash: string | null;
  accountKey: Uint8Array<ArrayBuffer> | undefined;
}>;

export function parseFindTransactionRequest(
  input: unknown
): FindTransactionInputType | undefined {
  const parsed = FindTransactionRequestSchema.safeParse(input);
  if (!parsed.success) {
    return undefined;
  }
  return {
    txid: parsed.data.txid,
    memoHash: parsed.data.memoHash ?? null,
    accountKey:
      parsed.data.accountKey == null
        ? undefined
        : accountKeyFromBase64(parsed.data.accountKey),
  };
}

/**
 * The memo's bytes as the wallet puts them in the shielded output, before the
 * zero padding - the addon's own rule (native/src/lib.rs
 * `interpret_memo_string`, zingolib's): text that starts with "0x" and is
 * entirely hex is those bytes; anything else is its UTF-8. Trailing zero bytes
 * are the padding, so they are not part of the memo either way.
 */
export function memoBytesAsSent(memo: string): Buffer<ArrayBuffer> {
  let bytes: Buffer<ArrayBuffer>;
  const hex = memo.slice(2);
  if (
    memo.toLowerCase().startsWith('0x') &&
    hex.length % 2 === 0 &&
    /^[0-9a-fA-F]*$/.test(hex)
  ) {
    bytes = Buffer.from(hex, 'hex');
  } else {
    bytes = Buffer.from(memo, 'utf8');
  }
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1;
  }
  return bytes.subarray(0, end);
}

/**
 * What a payment notice carries as `memoHash`: SHA-256 of the memo put in the
 * shielded output, or null when the payment carried none.
 */
export function memoHashFor(memo: string | null): string | null {
  if (memo == null || memo === '') {
    return null;
  }
  const bytes = memoBytesAsSent(memo);
  if (bytes.length === 0) {
    return null;
  }
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Whether the memos a wallet read from a transaction include the one a notice
 * describes. The wallet reads a text memo as its UTF-8 without the padding,
 * which is exactly what the sender hashed.
 */
export function memoVerdictFor(
  claimed: string | null,
  memos: ReadonlyArray<string>
): MemoVerdictType {
  const readable = memos.filter(memo => memo !== '');
  if (claimed == null) {
    return readable.length === 0 ? 'none' : 'mismatch';
  }
  if (readable.length === 0) {
    return 'unreadable';
  }
  return readable.some(
    memo =>
      createHash('sha256').update(Buffer.from(memo, 'utf8')).digest('hex') ===
      claimed
  )
    ? 'match'
    : 'mismatch';
}

/**
 * One transaction as the wallet sees it, from all its value transfers (the
 * wallet lists one per pool received into, and one per recipient sent to).
 * Amounts come from the wallet; nothing here is taken from a notice.
 */
export function summarizeFoundTransfers(
  transfers: ReadonlyArray<FoundTransferType>,
  claimedMemoHash: string | null,
  network: SwarmWalletNetworkIdType
): FindTransactionResultType {
  let receivedZat = 0n;
  let sentZat = 0n;
  let confirmed = transfers.length > 0;
  let failed = false;
  let blockHeight: number | null = null;
  const incomingMemos: Array<string> = [];
  for (const transfer of transfers) {
    const amount = BigInt(transfer.amountZat);
    if (transfer.direction === 'in') {
      receivedZat += amount;
      incomingMemos.push(...transfer.memos);
    } else if (transfer.direction === 'out' && !transfer.toSelf) {
      sentZat += amount;
    }
    if (transfer.status !== 'confirmed') {
      confirmed = false;
    }
    if (transfer.status === 'failed') {
      failed = true;
    }
    if (transfer.status === 'confirmed' && transfer.blockHeight != null) {
      blockHeight = transfer.blockHeight;
    }
  }
  const memos =
    incomingMemos.length > 0
      ? incomingMemos
      : transfers.flatMap(transfer => transfer.memos);
  const memoText = memos.find(memo => memo !== '') ?? null;
  return {
    status: 'found',
    chain: chainLabelOf(network),
    receivedZat: receivedZat.toString(),
    sentZat: sentZat.toString(),
    confirmed,
    failed,
    blockHeight: confirmed ? blockHeight : null,
    memo: memoVerdictFor(claimedMemoHash, memos),
    memoText,
  };
}

// Failures ------------------------------------------------------------------------

/** What an addon or wallet failure means, for the pane. */
export function classifyWalletFailure(
  code: string,
  message: string
): SwarmWalletProblemType {
  if (code === 'addon-missing') {
    return 'addon-missing';
  }
  if (code === 'wrong-chain') {
    return 'wrong-chain';
  }
  if (code === 'timeout' || isNetworkFailure(message)) {
    return 'offline';
  }
  if (code === 'wallet-file') {
    return 'wallet-file';
  }
  return 'unexpected';
}

/** Whether a failure is the light server not answering, in the addon's words. */
export function isNetworkFailure(message: string): boolean {
  return /transport error|tcp connect|dns error|timed? ?out|deadline|connection refused|forcibly closed|actively refused|unreachable|No connection could be made|os error 1006[01]|error trying to connect|broken pipe/i.test(
    message
  );
}

/** Whether the addon refused a payment because the wallet cannot cover it. */
export function isInsufficientFunds(message: string): boolean {
  return /insufficient|not enough (funds|balance)/i.test(message);
}

/**
 * A failure message with anything shaped like an address removed, for the log.
 * The rule for the whole wallet: no address in any log, because an address in
 * a debug log that is later shared links its owner to every payment to it.
 */
export function redactForLog(text: string): string {
  return redactRecoveryWords(
    text
      // bech32 / bech32m: human-readable part, separator, 20+ data characters.
      .replace(/\b[a-z]{1,15}1[02-9ac-hj-np-z]{20,}\b/gi, '<address>')
      // Base58Check transparent addresses.
      .replace(/\b[st][13mM2][1-9A-HJ-NP-Za-km-z]{20,40}\b/g, '<address>')
  );
}

/**
 * SWARM addition (B6, 2026-09-29): six or more BIP-39 words in a row are taken
 * for a recovery phrase, or part of one, and replaced. Ordinary English has
 * runs like that only rarely, and a log line that loses a few words is a small
 * price next to one that keeps a phrase.
 */
const RECOVERY_WORDS_IN_A_ROW = 6;

const BIP39_WORDS: ReadonlySet<string> = new Set(BIP39_ENGLISH_WORDLIST);

function redactRecoveryWords(text: string): string {
  return text.replace(/[A-Za-z]+(?:[\s,;]+[A-Za-z]+)*/g, sequence => {
    // Even indices are words, odd indices the separators between them.
    const tokens = sequence.split(/([\s,;]+)/);
    let result = '';
    let runStart = -1;
    const closeRun = (end: number) => {
      const words = (end - runStart + 1) / 2;
      result +=
        words >= RECOVERY_WORDS_IN_A_ROW
          ? '<words>'
          : tokens.slice(runStart, end).join('');
      runStart = -1;
    };
    for (let index = 0; index < tokens.length; index += 2) {
      const word = tokens[index] ?? '';
      const separator = index > 0 ? (tokens[index - 1] ?? '') : '';
      if (BIP39_WORDS.has(word.toLowerCase())) {
        if (runStart === -1) {
          result += separator;
          runStart = index;
        }
      } else {
        if (runStart !== -1) {
          closeRun(index - 1);
        }
        result += separator + word;
      }
    }
    if (runStart !== -1) {
      closeRun(tokens.length);
    }
    return result;
  });
}
