// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): what the wallet worker does with each request.
//
// Kept apart from the worker's entry point so that a test can drive it with a
// fake addon. All wallet logic is swarm-wallet-core's; this file only decides
// which of its calls each request makes, and refuses the two things it must
// never do on its own:
//
//  - create a wallet with a seed of its own. `SwarmWallet.openOrCreate` makes a
//    new random seed when the directory is empty; here an empty directory is an
//    answer ('no-wallet'), because a SWARM account's wallet is the recovery
//    phrase the person wrote down at sign-in and nothing else.
//  - transmit anything that was not quoted first, or a quote that has expired.

import { randomBytes } from 'node:crypto';

import { SwarmWallet, SwarmWalletError, WalletStore } from 'swarm-wallet-core';
import type {
  NativeAddon,
  SendQuote,
  WalletTransaction,
} from 'swarm-wallet-core';

import { checkRecoveryPhrase } from '../util/swarm/bip39.node.ts';
import { codeOf, codedError, messageOf } from './swarmWalletProtocol.std.ts';
import type {
  FoundTransferType,
  OpenResultType,
  QuoteSnapshotType,
  SendSnapshotType,
  ServerSnapshotType,
  TransactionSnapshotType,
  WalletLocationType,
  WalletSnapshotType,
  WorkerErrorType,
  WorkerRequestType,
} from './swarmWalletProtocol.std.ts';

/** How long a quote may be confirmed for. The fee is only good for so long. */
export const QUOTE_LIFETIME_MS = 2 * 60 * 1000;

/** How many transactions the pane is sent. */
export const TRANSACTIONS_SHOWN = 50;

export function toWorkerError(error: unknown): WorkerErrorType {
  if (error instanceof SwarmWalletError) {
    return { code: error.code, message: error.message };
  }
  return { code: codeOf(error), message: messageOf(error) };
}

type PendingQuoteType = {
  id: string;
  quote: SendQuote;
  expiresAt: number;
};

export type WalletHandlerOptionsType = Readonly<{
  loadAddon: () => NativeAddon;
  now?: () => number;
}>;

export class SwarmWalletHandler {
  readonly #loadAddon: () => NativeAddon;

  readonly #now: () => number;

  #wallet: SwarmWallet | undefined;

  #pending: PendingQuoteType | undefined;

  #sync: Promise<void> | undefined;

  /**
   * SWARM addition (0.1.4): wallet files this worker moved onto the SWARM
   * network restarted on 2 October 2026, whose move has not been reported yet.
   * The move happens before the open, and an open can still fail after it (a
   * light server that does not answer), so the fact is kept until an open of
   * the same file succeeds and can say so.
   */
  readonly #movedNotReported = new Set<string>();

  constructor({ loadAddon, now = Date.now }: WalletHandlerOptionsType) {
    this.#loadAddon = loadAddon;
    this.#now = now;
  }

  async handle(request: WorkerRequestType): Promise<unknown> {
    switch (request.kind) {
      case 'exists':
        return walletFileExists(request);
      case 'open':
        return this.#open(request.location);
      case 'restore':
        return this.#restore(
          request.location,
          request.phrase,
          request.birthdayHeight
        );
      case 'switch':
        return this.#switch(request.location, request.birthdayHeight);
      case 'server-height':
        return this.#serverHeight(request.server);
      case 'server':
        return this.#server();
      case 'snapshot':
        return this.#snapshot();
      case 'sync':
        return this.#startSync();
      case 'quote':
        return this.#quote(request.to, request.amountZat, request.memo);
      case 'confirm':
        return this.#confirm(request.quoteId);
      case 'cancel':
        this.#pending = undefined;
        return true;
      case 'close':
        await this.#close();
        return true;
      // SWARM addition (M3 wave 2): payments inside a chat.
      case 'new-address':
        return this.#requireWallet().newAddress();
      case 'find-transaction':
        return this.#findTransaction(request.txid);
      // SWARM addition (B6, 2026-09-29): recovery phrase export.
      case 'seed-phrase':
        return this.#seedPhraseBytes();
      default:
        throw codedError(
          'unexpected',
          `unknown request ${(request as { kind: string }).kind}`
        );
    }
  }

  // Opening -------------------------------------------------------------------

  async #open(location: WalletLocationType): Promise<OpenResultType> {
    await this.#close();
    if (!(await walletFileExists(location))) {
      throw codedError(
        'no-wallet',
        'there is no wallet for this account on this computer'
      );
    }
    const options = {
      addon: this.#loadAddon(),
      dataDir: location.dataDir,
      walletName: location.walletName,
      chain: location.chain,
      server: location.server,
      ...(location.encryptionKey == null
        ? {}
        : { encryptionKey: location.encryptionKey }),
    };
    // SWARM addition (0.1.4): a wallet file written on the SWARM Mainnet chain
    // abandoned on 2 October 2026 is moved onto the restarted chain BEFORE it
    // is opened: same keys and addresses, a fresh view from the new chain's
    // first block, a sealed backup of the old file beside it. Offline, and
    // nothing at all when the file is already on the restarted chain (or on
    // the testnet). openOrCreate would do the same by itself; doing it here
    // first is what lets the move be reported even when this open then fails.
    const key = movedKey(location);
    const moved = await SwarmWallet.moveWalletToRestartedChain(options);
    if (moved != null) {
      this.#movedNotReported.add(key);
    }
    this.#wallet = await SwarmWallet.openOrCreate(options);
    const restarted =
      this.#movedNotReported.delete(key) || this.#wallet.restartMove != null;
    return { restarted };
  }

  async #restore(
    location: WalletLocationType,
    phrase: string,
    birthdayHeight: number
  ): Promise<OpenResultType> {
    await this.#close();
    // restoreFromSeed refuses a directory that already holds a wallet, which is
    // what protects a funded wallet from being written over; an existing wallet
    // for the same account is simply opened.
    if (await walletFileExists(location)) {
      return this.#open(location);
    }
    this.#wallet = await SwarmWallet.restoreFromSeed({
      addon: this.#loadAddon(),
      dataDir: location.dataDir,
      walletName: location.walletName,
      chain: location.chain,
      server: location.server,
      seedPhrase: phrase,
      birthdayHeight,
      ...(location.encryptionKey == null
        ? {}
        : { encryptionKey: location.encryptionKey }),
    });
    return { restarted: false };
  }

  /**
   * The same seed on another network. The phrase is read from the open wallet
   * and handed straight back to the addon: it never leaves this thread.
   */
  async #switch(
    location: WalletLocationType,
    birthdayHeight: number
  ): Promise<OpenResultType> {
    const wallet = this.#requireWallet();
    const { phrase } = await wallet.seedPhrase();
    return this.#restore(location, phrase, birthdayHeight);
  }

  /**
   * SWARM addition (B6, 2026-09-29): the words of the open wallet, for the
   * person who asked to see them. Checked here as a BIP-39 phrase, so what is
   * shown is exactly what "I have a recovery phrase" accepts; a wallet that
   * answered anything else is refused rather than shown. The bytes have a
   * buffer of their own so the worker can transfer it instead of copying it.
   */
  async #seedPhraseBytes(): Promise<Uint8Array<ArrayBuffer>> {
    const { phrase } = await this.#requireWallet().seedPhrase();
    const check = checkRecoveryPhrase(phrase);
    if (!check.valid) {
      // The reason only: never the words.
      throw codedError(
        'malformed-response',
        `the wallet's recovery phrase is not a valid 24-word phrase (${check.problem.type})`
      );
    }
    return new TextEncoder().encode(check.phrase);
  }

  async #close(): Promise<void> {
    this.#pending = undefined;
    const wallet = this.#wallet;
    this.#wallet = undefined;
    if (wallet != null) {
      await wallet.close();
    }
  }

  // Reading -------------------------------------------------------------------

  async #serverHeight(server: string): Promise<number> {
    const answer = await this.#loadAddon().get_latest_block_server(server);
    const height = readHeight(answer);
    if (height == null) {
      throw codedError(
        'malformed-response',
        'the light server answered without a height'
      );
    }
    return height;
  }

  async #server(): Promise<ServerSnapshotType> {
    const info = await this.#requireWallet().serverInfo();
    return {
      chainName: info.chainName,
      blockHeight: info.blockHeight,
      genesisVerified: info.genesisVerified,
    };
  }

  async #snapshot(): Promise<WalletSnapshotType> {
    const wallet = this.#requireWallet();
    const balance = await wallet.balance();
    const addresses = await wallet.addresses();
    const status = await wallet.syncStatus();
    const transactions = await wallet.transactions();

    return {
      totalZat: balance.totalZat.toString(),
      spendableZat: balance.spendableZat.toString(),
      pendingZat: balance.pendingZat.toString(),
      address: addresses.unified[0] ?? null,
      syncing: this.#sync != null || status.syncing,
      syncedHeight: status.syncedHeight,
      transactions: [...transactions]
        .reverse()
        .slice(0, TRANSACTIONS_SHOWN)
        .flatMap((transaction): Array<TransactionSnapshotType> => {
          const txid = transaction.txid.toLowerCase();
          if (!/^[0-9a-f]{64}$/.test(txid)) {
            return [];
          }
          const {
            status: transferStatus,
            blockHeight,
            memos,
          } = readTransfer(transaction);
          return [
            {
              txid,
              direction: transaction.direction,
              amountZat: transaction.amountZat.toString(),
              feeZat:
                transaction.feeZat == null
                  ? null
                  : transaction.feeZat.toString(),
              // SWARM change (M3 wave 2): "in a block" from the wallet's own
              // confirmation status; a transaction in the mempool has a target
              // height, not a block.
              blockHeight: transferStatus === 'confirmed' ? blockHeight : null,
              timestamp: transaction.timestamp,
              memo: memos.length === 0 ? null : memos.join('\n'),
            },
          ];
        }),
    };
  }

  /**
   * SWARM addition (M3 wave 2): every value transfer of one transaction, as the
   * wallet has it. Empty when the wallet has not seen the transaction.
   */
  async #findTransaction(
    txid: string
  ): Promise<ReadonlyArray<FoundTransferType>> {
    const transactions = await this.#requireWallet().transactions();
    return transactions
      .filter(transaction => transaction.txid.toLowerCase() === txid)
      .map(transaction => {
        const { status, blockHeight, memos, toSelf } =
          readTransfer(transaction);
        return {
          direction: transaction.direction,
          toSelf,
          amountZat: transaction.amountZat.toString(),
          status,
          blockHeight,
          memos,
        };
      });
  }

  /** Starts one sync if none is running, and answers at once. */
  #startSync(): boolean {
    const wallet = this.#requireWallet();
    if (this.#sync == null) {
      this.#sync = (async () => {
        try {
          await wallet.sync();
        } catch {
          // The next snapshot shows how far it got; the main process decides
          // whether the light server is gone from its own call to it.
        } finally {
          this.#sync = undefined;
        }
      })();
    }
    return true;
  }

  // Sending -------------------------------------------------------------------

  async #quote(
    to: string,
    amountZat: string,
    memo: string | null
  ): Promise<QuoteSnapshotType> {
    const wallet = this.#requireWallet();
    // A new quote replaces the old one, as it does inside the addon, which
    // holds exactly one proposal.
    this.#pending = undefined;
    const quote = await wallet.proposeSend({
      to,
      amountZat: BigInt(amountZat),
      ...(memo == null ? {} : { memo }),
    });
    const id = randomBytes(16).toString('hex');
    this.#pending = {
      id,
      quote,
      expiresAt: this.#now() + QUOTE_LIFETIME_MS,
    };
    return { quoteId: id, feeZat: quote.feeZat.toString() };
  }

  async #confirm(quoteId: string): Promise<SendSnapshotType> {
    this.#requireWallet();
    const pending = this.#pending;
    // One shot: whatever happens next, this quote cannot be confirmed twice.
    this.#pending = undefined;
    if (pending == null || pending.id !== quoteId) {
      throw codedError(
        'quote-expired',
        'there is no such payment waiting to be confirmed'
      );
    }
    if (this.#now() > pending.expiresAt) {
      throw codedError(
        'quote-expired',
        'the payment was quoted too long ago; review it again'
      );
    }
    const result = await pending.quote.confirm();
    return { txids: [...result.txids], saved: result.saved };
  }

  #requireWallet(): SwarmWallet {
    if (this.#wallet == null) {
      throw codedError('not-open', 'no wallet is open');
    }
    return this.#wallet;
  }
}

/** Which wallet file a location names, as a key for `#movedNotReported`. */
function movedKey({
  dataDir,
  walletName,
  chain,
}: Readonly<{ dataDir: string; walletName: string; chain: string }>): string {
  return JSON.stringify([dataDir, chain, walletName]);
}

/**
 * Whether a wallet file - sealed or, from an older run, in the clear - is at
 * this location. `WalletStore` only looks for the sealed file when it has a
 * key, so it is given one; `exists()` reads no file and uses no key.
 */
export async function walletFileExists({
  dataDir,
  walletName,
  chain,
}: Readonly<{
  dataDir: string;
  walletName: string;
  chain: string;
}>): Promise<boolean> {
  return new WalletStore({
    dataDir,
    walletName,
    chain,
    encryptionKey: new Uint8Array(32),
  }).exists();
}

/** Kinds the wallet uses for a payment to its own addresses. */
const SELF_KINDS = new Set([
  'sendtoself',
  'memotoself',
  'shield',
  'shielding',
  'refund',
  'migration',
]);

/**
 * SWARM addition (M3 wave 2): what swarm-wallet-core (0.2.0, 0.3.0) does not read from a
 * value transfer. The SDK (zingolib) writes `status` ("confirmed", "mempool",
 * "transmitted", "calculated", "failed"), a `blockheight` that is only a
 * target height until the status is "confirmed", and the text memos as an
 * array `memos` - where the wrapper reads a single `memo`, so on its own the
 * pane would never show a memo.
 */
export function readTransfer(transaction: WalletTransaction): {
  status: 'confirmed' | 'pending' | 'failed';
  blockHeight: number | null;
  memos: ReadonlyArray<string>;
  toSelf: boolean;
} {
  const raw: Record<string, unknown> =
    transaction.raw != null && typeof transaction.raw === 'object'
      ? (transaction.raw as Record<string, unknown>)
      : {};
  const stated =
    typeof raw.status === 'string' ? raw.status.toLowerCase() : undefined;
  let status: 'confirmed' | 'pending' | 'failed';
  if (stated == null) {
    status = transaction.blockHeight == null ? 'pending' : 'confirmed';
  } else if (stated === 'confirmed') {
    status = 'confirmed';
  } else if (stated === 'failed') {
    status = 'failed';
  } else {
    status = 'pending';
  }

  const memos: Array<string> = [];
  const add = (memo: unknown) => {
    if (typeof memo === 'string' && memo !== '' && !memos.includes(memo)) {
      memos.push(memo);
    }
  };
  add(transaction.memo);
  if (Array.isArray(raw.memos)) {
    raw.memos.forEach(add);
  }

  const kind = transaction.kind.toLowerCase().replace(/[^a-z]/g, '');
  return {
    status,
    blockHeight: transaction.blockHeight,
    memos,
    toSelf: SELF_KINDS.has(kind),
  };
}

/** `get_latest_block_server` answers a bare number or `{"height": N}`. */
export function readHeight(answer: unknown): number | undefined {
  const parse = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      return value >= 0 ? value : undefined;
    }
    if (typeof value === 'string' && /^[0-9]{1,15}$/.test(value.trim())) {
      return Number(value.trim());
    }
    return undefined;
  };
  const direct = parse(answer);
  if (direct != null) {
    return direct;
  }
  if (typeof answer === 'string') {
    try {
      const parsed: unknown = JSON.parse(answer);
      if (parsed != null && typeof parsed === 'object' && 'height' in parsed) {
        return parse(parsed.height);
      }
      return parse(parsed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
