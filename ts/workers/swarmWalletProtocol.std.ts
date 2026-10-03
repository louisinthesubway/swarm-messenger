// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): the messages between the wallet service in the
// main process (app/SwarmWalletService.main.ts) and the worker thread that
// holds the wallet (ts/workers/swarmWalletWorker.node.ts).
//
// Why a worker: several of the addon's entry points are synchronous and block
// the thread that calls them - opening a wallet derives keys and reads the
// file, and the Rust side blocks on its own runtime - and the main process is
// the thread every window's IPC goes through. A wallet that is slow, or a light
// server that does not answer, must never be able to freeze the chat.
//
// The worker is part of the main process: it is not a renderer, it is not
// sandboxed web content, and nothing it holds crosses into a window.

export type WorkerDataType = Readonly<{
  /** Absolute path of the wallet addon for this platform. */
  addonPath: string;
}>;

/**
 * Where one wallet lives, and how it is opened.
 *
 * Every account's wallet shares one base directory and has a file of its own.
 * The addon's base directory is set once per process and can never change
 * (a OnceCell with no reset), so per-account directories would make a second
 * account in the same run unopenable; per-account file names do not.
 */
export type WalletLocationType = Readonly<{
  /** `<userData>/swarm-wallet`; the addon adds the chain subdirectory. */
  dataDir: string;
  /** `wallet-<account id>.dat`, from the account's identity key. */
  walletName: string;
  /** `swarm-mainnet` or `swarm-testnet`. */
  chain: string;
  /** The light server, `https://host:port`. */
  server: string;
  /** 32 bytes from the OS keychain, or null for a wallet file left in the clear. */
  encryptionKey: Uint8Array<ArrayBuffer> | null;
}>;

export type WorkerRequestType =
  | Readonly<{
      kind: 'exists';
      dataDir: string;
      walletName: string;
      chain: string;
    }>
  | Readonly<{ kind: 'open'; location: WalletLocationType }>
  | Readonly<{
      kind: 'restore';
      location: WalletLocationType;
      /** The recovery phrase. Used once, never logged, never answered back. */
      phrase: string;
      birthdayHeight: number;
    }>
  | Readonly<{
      kind: 'switch';
      /** Where to reopen the same seed, on another network. */
      location: WalletLocationType;
      birthdayHeight: number;
    }>
  | Readonly<{ kind: 'server-height'; server: string }>
  | Readonly<{ kind: 'server' }>
  | Readonly<{ kind: 'snapshot' }>
  | Readonly<{ kind: 'sync' }>
  | Readonly<{
      kind: 'quote';
      to: string;
      /** Zatoshi, as a decimal string. */
      amountZat: string;
      memo: string | null;
    }>
  | Readonly<{ kind: 'confirm'; quoteId: string }>
  | Readonly<{ kind: 'cancel' }>
  | Readonly<{ kind: 'close' }>
  // SWARM addition (M3 wave 2): payments inside a chat.
  /** A new unified address of the open wallet, for one conversation. */
  | Readonly<{ kind: 'new-address' }>
  /** Every value transfer of one transaction, for binding a payment notice. */
  | Readonly<{ kind: 'find-transaction'; txid: string }>
  // SWARM addition (B6, 2026-09-29): recovery phrase export.
  /**
   * The open wallet's recovery phrase, checked and normalized, as UTF-8 bytes
   * in a buffer of their own (the worker transfers it, keeping no copy). Only
   * app/SwarmRecoveryPhraseExport.main.ts asks, for the reveal window.
   */
  | Readonly<{ kind: 'seed-phrase' }>;

export type WorkerMessageType = Readonly<{
  id: number;
  request: WorkerRequestType;
}>;

export type WorkerErrorType = Readonly<{
  /** `SwarmWalletError.code`, `no-wallet`, `quote-expired`, or `unexpected`. */
  code: string;
  message: string;
}>;

export type WorkerReplyType =
  | Readonly<{ id: number; ok: true; value: unknown }>
  | Readonly<{ id: number; ok: false; error: WorkerErrorType }>;

/**
 * SWARM addition (0.1.4): what `open`, `restore` and `switch` answer. `restarted`
 * is true when the wallet file was moved onto the SWARM network restarted on
 * 2 October 2026 before it was opened (swarm-wallet-core 0.3.0), so the pane can
 * tell its owner once.
 */
export type OpenResultType = Readonly<{ restarted: boolean }>;

/** What the light server says, through the open wallet. */
export type ServerSnapshotType = Readonly<{
  chainName: string;
  blockHeight: number | null;
  genesisVerified: boolean;
}>;

/** One transaction, ready for the pane. Amounts are zatoshi strings. */
export type TransactionSnapshotType = Readonly<{
  txid: string;
  direction: 'in' | 'out' | 'unknown';
  amountZat: string;
  feeZat: string | null;
  blockHeight: number | null;
  timestamp: number | null;
  memo: string | null;
}>;

/**
 * SWARM addition (M3 wave 2): one value transfer of a transaction, as the chat
 * binds a payment notice to it. The wallet lists one per pool a transaction
 * was received into and one per recipient it paid, so a txid can have several.
 */
export type FoundTransferType = Readonly<{
  direction: 'in' | 'out' | 'unknown';
  /** A payment to this wallet's own addresses (change, shielding, memo to self). */
  toSelf: boolean;
  amountZat: string;
  /** From the wallet's confirmation status: in a block, not yet, or failed. */
  status: 'confirmed' | 'pending' | 'failed';
  blockHeight: number | null;
  /** The text memos the wallet read, without padding. */
  memos: ReadonlyArray<string>;
}>;

/** Everything the pane shows that the wallet knows without the network. */
export type WalletSnapshotType = Readonly<{
  totalZat: string;
  spendableZat: string;
  pendingZat: string;
  address: string | null;
  syncing: boolean;
  syncedHeight: number | null;
  /** Newest first. */
  transactions: ReadonlyArray<TransactionSnapshotType>;
}>;

export type QuoteSnapshotType = Readonly<{
  quoteId: string;
  feeZat: string;
}>;

export type SendSnapshotType = Readonly<{
  txids: ReadonlyArray<string>;
  saved: boolean;
}>;

/** An Error with a machine-readable code, as both sides of the worker use. */
export type CodedErrorType = Error & { code: string };

export function codedError(code: string, message: string): CodedErrorType {
  const error = new Error(message) as CodedErrorType;
  error.code = code;
  return error;
}

/** The code of an error from either side, or 'unexpected'. */
export function codeOf(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'unexpected';
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
