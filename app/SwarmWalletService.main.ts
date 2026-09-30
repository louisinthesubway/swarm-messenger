// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): the wallet service. It owns the SWARM wallet on
// behalf of the Wallet pane, and it is the only thing that does.
//
//   renderer (Wallet pane)
//     │  ipcRenderer.invoke('swarm-wallet:*')   ts/types/SwarmWallet.std.ts
//     ▼
//   main process, this file                     validates every request
//     │  postMessage                             ts/workers/swarmWalletProtocol.std.ts
//     ▼
//   worker thread (ts/workers/swarmWalletWorker.node.ts)
//     swarm-wallet-core 0.2.0 + the Rust addon: keys, wallet file, light server
//
// The renderer never receives a key, a seed, a path or a wallet object. (One
// exception, B6: the person can ask to see their recovery phrase, and a small
// window of its own - never the main window - is sent the words once, after a
// local confirmation. See app/SwarmRecoveryPhraseExport.main.ts.) It
// sends the recovery phrase once - when the wallet is first opened from it, at
// sign-in or from the pane's restore form - and gets a state back. Sending
// money is two calls, quote and confirm, and the quote lives here: the renderer
// can only confirm the payment it was shown.
//
// Nothing here may block the chat. Every call into the wallet goes to the
// worker with a timeout, the pane reads a cached state, and a light server that
// does not answer turns into the 'offline' state, never into a wait.
//
// Logging: outcomes by category only. Never a phrase, a key, an address, an
// amount or a transaction id.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { app, ipcMain, safeStorage } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import config from './config.main.ts';
import * as ephemeralConfig from './ephemeral_config.main.ts';
import * as userConfig from './user_config.main.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import { drop } from '../ts/util/drop.std.ts';
import { getAppRootDir } from '../ts/util/appRootDir.main.ts';
import OS from '../ts/util/os/osMain.node.ts';
import { zatoshiFromString } from '../ts/util/swarm/swmAmount.std.ts';
import {
  SWARM_WALLET_NETWORKS,
  accountKeyForPhrase,
  chainLabelOf,
  checkAddressFor,
  classifyWalletFailure,
  describeNetwork,
  isInsufficientFunds,
  isNetworkFailure,
  memoHashFor,
  parseCheckAddressRequest,
  parseConfirmSendRequest,
  parseFindTransactionRequest,
  parseGetStateRequest,
  parseNewAddressRequest,
  parseOpenWithPhraseRequest,
  parseServerOverride,
  parseSetNetworkRequest,
  redactForLog,
  refusal,
  sameAccountKey,
  summarizeFoundTransfers,
  validateSendRequest,
  walletFileNameFor,
} from '../ts/util/swarm/walletIpc.node.ts';
import { SWARM_WALLET_CHANNEL } from '../ts/types/SwarmWallet.std.ts';
import type {
  CheckAddressResultType,
  ConfirmSendResultType,
  FindTransactionResultType,
  NewAddressResultType,
  QuoteSendResultType,
  SendQuoteType,
  SendRefusalKindType,
  SwarmWalletNetworkIdType,
  SwarmWalletProblemType,
  SwarmWalletStateType,
  SwarmWalletStatusType,
} from '../ts/types/SwarmWallet.std.ts';
import {
  codeOf,
  codedError,
  messageOf,
} from '../ts/workers/swarmWalletProtocol.std.ts';
import { waitForRecoveryPhrase } from '../ts/util/swarm/recoveryPhraseRead.std.ts';
import type { RecoveryPhraseReadResultType } from '../ts/util/swarm/recoveryPhraseRead.std.ts';
import type {
  CodedErrorType,
  FoundTransferType,
  QuoteSnapshotType,
  SendSnapshotType,
  ServerSnapshotType,
  WalletLocationType,
  WalletSnapshotType,
  WorkerReplyType,
  WorkerRequestType,
} from '../ts/workers/swarmWalletProtocol.std.ts';

const log = createLogger('SwarmWalletService');

/** How long each kind of call may take before the pane is told something. */
const TIMEOUT_MS = {
  quick: 15_000,
  open: 45_000,
  quote: 90_000,
  // Building, proving and broadcasting a shielded payment.
  confirm: 300_000,
} as const;

/** How often the open wallet is refreshed while somebody is looking at it. */
const REFRESH_EVERY_MS = 10_000;
const SYNC_EVERY_MS = 60_000;
const RETRY_OFFLINE_EVERY_MS = 30_000;
/** After this long without the pane asking, the background work stops. */
const PANE_IDLE_AFTER_MS = 2 * 60 * 1000;
/** How far below the tip a phrase generated just now can have been paid. */
const NEW_PHRASE_BIRTHDAY_MARGIN = 100;

const KEY_CONFIG_NAME = 'swarmWalletEncryptedKey';
const NETWORK_SETTING_NAME = 'swarm-wallet-network';

type PendingCallType = {
  resolve: (value: unknown) => void;
  reject: (error: CodedErrorType) => void;
  timer: NodeJS.Timeout;
};

/** Which refusal a failed quote or send is, from the wallet's own words. */
function refusalKindFor(message: string): SendRefusalKindType {
  if (isInsufficientFunds(message)) {
    return 'insufficient-funds';
  }
  if (isNetworkFailure(message)) {
    return 'offline';
  }
  return 'rejected';
}

function statusFor(problem: SwarmWalletProblemType): SwarmWalletStatusType {
  if (problem === 'offline') {
    return 'offline';
  }
  if (problem === 'addon-missing') {
    return 'unavailable';
  }
  return 'error';
}

type CurrentQuoteType = {
  summary: SendQuoteType;
};

export type SwarmWalletServiceOptionsType = Readonly<{
  userDataPath: string;
  getMainWindow: () => BrowserWindow | undefined;
}>;

export class SwarmWalletService {
  static create(options: SwarmWalletServiceOptionsType): SwarmWalletService {
    return new SwarmWalletService(options);
  }

  readonly #userDataPath: string;

  readonly #getMainWindow: () => BrowserWindow | undefined;

  readonly #canSwitchNetwork: boolean;

  readonly #serverOverride: string | undefined;

  #network: SwarmWalletNetworkIdType;

  #worker: Worker | undefined;

  #nextCallId = 1;

  readonly #calls = new Map<number, PendingCallType>();

  /**
   * SWARM addition (0.1.3): every request posted to the worker that it has not
   * answered yet - also those whose caller stopped waiting. The worker answers
   * in arrival order, so a request waits for every one of these that is older.
   */
  readonly #inWorker = new Set<number>();

  /**
   * SWARM addition (0.1.3): whether a sync is running in the worker, as far as
   * this process knows: set when one is started, and from every snapshot.
   */
  #syncRunning = false;

  // What the pane is shown.
  #status: SwarmWalletStatusType = 'no-wallet';

  #problem: SwarmWalletProblemType | null = null;

  #snapshot: WalletSnapshotType | undefined;

  #serverHeight: number | null = null;

  #genesisVerified: boolean | null = null;

  #encryptedAtRest: boolean | null = null;

  #checkedAt: number | null = null;

  // Which account's wallet is open, or being opened.
  #accountKey: Uint8Array<ArrayBuffer> | undefined;

  /** Bumped by every open, so an old open finishing late changes nothing. */
  #generation = 0;

  #quote: CurrentQuoteType | undefined;

  #lastAskedAt = 0;

  #lastRefreshAt = 0;

  #lastSyncAt = 0;

  #lastAttemptAt = 0;

  #refreshing = false;

  #timer: NodeJS.Timeout | undefined;

  private constructor({
    userDataPath,
    getMainWindow,
  }: SwarmWalletServiceOptionsType) {
    this.#userDataPath = userDataPath;
    this.#getMainWindow = getMainWindow;
    // The developer network switch exists only outside a packaged release.
    this.#canSwitchNetwork = !app.isPackaged;
    this.#serverOverride = config.has('swarmWalletServer')
      ? parseServerOverride(config.get('swarmWalletServer'))
      : undefined;
    this.#network = this.#initialNetwork();

    if (!existsSync(this.#addonPath())) {
      this.#status = 'unavailable';
      this.#problem = 'addon-missing';
      log.warn('no wallet addon in this build; the Wallet pane will say so');
    }

    this.#handle(SWARM_WALLET_CHANNEL.getState, payload =>
      this.#getState(payload)
    );
    this.#handle(SWARM_WALLET_CHANNEL.openWithPhrase, payload =>
      this.#openWithPhrase(payload)
    );
    this.#handle(SWARM_WALLET_CHANNEL.refresh, () => this.#refreshNow());
    this.#handle(SWARM_WALLET_CHANNEL.quoteSend, payload =>
      this.#quoteSend(payload)
    );
    this.#handle(SWARM_WALLET_CHANNEL.confirmSend, payload =>
      this.#confirmSend(payload)
    );
    this.#handle(SWARM_WALLET_CHANNEL.cancelSend, () => this.#cancelSend());
    this.#handle(SWARM_WALLET_CHANNEL.setNetwork, payload =>
      this.#setNetwork(payload)
    );
    // SWARM addition (M3 wave 2): payments inside a chat.
    this.#handle(SWARM_WALLET_CHANNEL.newAddress, payload =>
      this.#newAddress(payload)
    );
    this.#handle(SWARM_WALLET_CHANNEL.checkAddress, payload =>
      this.#checkAddress(payload)
    );
    this.#handle(SWARM_WALLET_CHANNEL.findTransaction, payload =>
      this.#findTransaction(payload)
    );

    log.info(
      `ready: network ${this.#network}, server ${this.#server()}` +
        (this.#serverOverride ? ' (developer override)' : '')
    );
  }

  /** The chain label of the network the wallet is on, e.g. `swarm-mainnet`. */
  chainLabel(): 'swarm-mainnet' | 'swarm-testnet' {
    return this.#network === 'mainnet' ? 'swarm-mainnet' : 'swarm-testnet';
  }

  // Recovery phrase export (B6) -------------------------------------------------

  /**
   * SWARM addition (B6, 2026-09-29): whether there is a signed-in account's
   * wallet whose words could be read. A quick answer for the pane; the read
   * itself can still refuse.
   */
  canExportRecoveryPhrase(): boolean {
    return (
      this.#accountKey != null &&
      (this.#status === 'ready' || this.#status === 'offline')
    );
  }

  /**
   * SWARM addition (B6, 2026-09-29): the open wallet's recovery phrase, as
   * UTF-8 bytes, for app/SwarmRecoveryPhraseExport.main.ts and nobody else -
   * it is not reachable over IPC. The caller hands the bytes to the reveal
   * window and zeroes them (deliverRecoveryPhraseOnce); this method zeroes them
   * itself when it refuses them.
   *
   * Refused, and zeroed, unless the words derive exactly the signed-in
   * account's identity key: what the person is shown must sign them into this
   * account, and no other.
   *
   * SWARM change (0.1.3, 2026-09-30): a wallet that is busy - syncing, or still
   * answering the Wallet pane's requests ahead of this one - is waited for, up
   * to three minutes, instead of fifteen seconds; `onBusy` is told when the read
   * starts waiting for it, and a wallet that stays busy is refused as 'busy'
   * rather than 'unreadable'. See ts/util/swarm/recoveryPhraseRead.std.ts.
   *
   * Logs the outcome only.
   */
  async readRecoveryPhrase({
    onBusy,
  }: { onBusy?: () => void } = {}): Promise<RecoveryPhraseReadResultType> {
    const accountKey = this.#accountKey;
    if (accountKey == null || this.#status === 'unavailable') {
      log.info('readRecoveryPhrase: refused, no wallet is open');
      return { ok: false, refusal: 'unreadable' };
    }
    let readId: number | undefined;
    const outcome = await waitForRecoveryPhrase({
      read: timeoutMs => {
        const { id, answer } = this.#post({ kind: 'seed-phrase' }, timeoutMs);
        readId = id;
        return answer;
      },
      isBusy: () => this.#syncRunning || this.#hasRequestsBefore(readId),
      onBusy: () => {
        log.info('readRecoveryPhrase: the wallet is busy; waiting for it');
        onBusy?.();
      },
    });
    if (outcome.type === 'busy') {
      log.warn('readRecoveryPhrase: not read, the wallet stayed busy');
      return { ok: false, refusal: 'busy' };
    }
    if (outcome.type === 'failed') {
      // The worker's message names a reason, never the words; redacted anyway.
      log.warn(
        `readRecoveryPhrase: not read (${this.#describe(outcome.error)})`
      );
      return { ok: false, refusal: 'unreadable' };
    }
    const bytes = outcome.value;
    if (!(bytes instanceof Uint8Array)) {
      log.warn('readRecoveryPhrase: the worker answered something else');
      return { ok: false, refusal: 'unreadable' };
    }
    const phrase = new Uint8Array(bytes);
    bytes.fill(0);
    let matches = false;
    try {
      matches =
        this.#accountKey === accountKey &&
        sameAccountKey(
          accountKeyForPhrase(new TextDecoder().decode(phrase)),
          accountKey
        );
    } catch {
      matches = false;
    }
    if (!matches) {
      phrase.fill(0);
      log.warn(
        'readRecoveryPhrase: refused, the words are not the signed-in account'
      );
      return { ok: false, refusal: 'unreadable' };
    }
    log.info('readRecoveryPhrase: read for the reveal window');
    return { ok: true, bytes: phrase };
  }

  /** Whether the worker still has requests older than `id` to answer. */
  #hasRequestsBefore(id: number | undefined): boolean {
    if (id == null) {
      return false;
    }
    for (const other of this.#inWorker) {
      if (other < id) {
        return true;
      }
    }
    return false;
  }

  /** Seals the wallet file and stops the worker. Called on the way out. */
  async shutdown(): Promise<void> {
    if (this.#timer != null) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#worker == null) {
      return;
    }
    try {
      await this.#call({ kind: 'close' }, TIMEOUT_MS.quick);
      log.info('shutdown: wallet closed');
    } catch (error) {
      log.warn(
        `shutdown: could not close the wallet (${this.#describe(error)})`
      );
    }
  }

  // IPC -------------------------------------------------------------------------

  #handle(channel: string, work: (payload: unknown) => Promise<unknown>): void {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!this.#isMainWindow(event)) {
        log.warn(`${channel}: refused a caller that is not the main window`);
        throw new Error('Not allowed');
      }
      return work(payload);
    });
  }

  /**
   * Only the main window's top frame may reach the wallet. Every other window
   * (About, debug log, PDF viewer, permissions, screen share) is sandboxed and
   * gets no wallet surface at all.
   */
  #isMainWindow(event: IpcMainInvokeEvent): boolean {
    const mainWindow = this.#getMainWindow();
    if (mainWindow == null || mainWindow.isDestroyed()) {
      return false;
    }
    return (
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame
    );
  }

  async #getState(payload: unknown): Promise<SwarmWalletStateType> {
    const request = parseGetStateRequest(payload);
    if (request == null) {
      throw new Error('Invalid request');
    }
    this.#lastAskedAt = Date.now();
    this.#startTimer();

    const { accountKey } = request;
    if (
      accountKey != null &&
      this.#status !== 'unavailable' &&
      (this.#accountKey == null ||
        !sameAccountKey(accountKey, this.#accountKey))
    ) {
      // The signed-in account's wallet, from its file. No phrase here: if
      // there is no file, the pane asks for the words.
      this.#open(accountKey, undefined);
    }
    return this.#state();
  }

  async #openWithPhrase(
    payload: unknown
  ): Promise<
    | { ok: true; state: SwarmWalletStateType }
    | { ok: false; problem: SwarmWalletProblemType }
  > {
    const request = parseOpenWithPhraseRequest(payload);
    if (!request.ok) {
      log.info(`openWithPhrase: refused (${request.problem})`);
      return { ok: false, problem: request.problem };
    }
    if (this.#status === 'unavailable') {
      return { ok: false, problem: 'addon-missing' };
    }
    this.#lastAskedAt = Date.now();
    this.#startTimer();
    log.info(
      `openWithPhrase: ${request.isNewPhrase ? 'new' : 'existing'} phrase accepted`
    );
    this.#open(request.accountKey, {
      phrase: request.phrase,
      isNewPhrase: request.isNewPhrase,
    });
    return { ok: true, state: this.#state() };
  }

  async #refreshNow(): Promise<SwarmWalletStateType> {
    this.#lastAskedAt = Date.now();
    if (
      this.#accountKey != null &&
      (this.#status === 'error' ||
        (this.#status === 'offline' && this.#snapshot == null))
    ) {
      this.#open(this.#accountKey, undefined, {
        retryWhileOffline: this.#status === 'offline',
      });
    } else {
      await this.#refresh({ forceSync: true });
    }
    return this.#state();
  }

  async #quoteSend(payload: unknown): Promise<QuoteSendResultType> {
    this.#lastAskedAt = Date.now();
    this.#quote = undefined;
    if (this.#status === 'offline') {
      return { ok: false, refusal: refusal('offline') };
    }
    const spendable =
      this.#status === 'ready' && this.#snapshot != null
        ? zatoshiFromString(this.#snapshot.spendableZat)
        : null;
    const { profile } = SWARM_WALLET_NETWORKS[this.#network];
    const validated = validateSendRequest(payload, profile, spendable);
    if (!validated.ok) {
      log.info(`quoteSend: refused before quoting (${validated.refusal.kind})`);
      return { ok: false, refusal: validated.refusal };
    }
    const { to, amountZat, memo } = validated.send;

    let quoted: QuoteSnapshotType;
    try {
      quoted = (await this.#call(
        { kind: 'quote', to, amountZat: amountZat.toString(), memo },
        TIMEOUT_MS.quote
      )) as QuoteSnapshotType;
    } catch (error) {
      const kind = refusalKindFor(messageOf(error));
      log.info(`quoteSend: the wallet refused (${kind})`);
      if (kind === 'insufficient-funds') {
        return {
          ok: false,
          refusal: refusal(kind, { needZat: amountZat, haveZat: spendable }),
        };
      }
      return { ok: false, refusal: refusal(kind) };
    }

    const feeZat = BigInt(quoted.feeZat);
    const totalZat = amountZat + feeZat;
    if (spendable != null && totalZat > spendable) {
      drop(this.#tryCall({ kind: 'cancel' }, TIMEOUT_MS.quick));
      log.info('quoteSend: refused, the fee takes it over the balance');
      return {
        ok: false,
        refusal: refusal('insufficient-funds', {
          needZat: totalZat,
          haveZat: spendable,
        }),
      };
    }

    const summary: SendQuoteType = {
      quoteId: quoted.quoteId,
      to,
      amountZat: amountZat.toString(),
      feeZat: feeZat.toString(),
      totalZat: totalZat.toString(),
      memo,
      expiresAt: Date.now() + 110_000,
    };
    this.#quote = { summary };
    log.info('quoteSend: quoted; waiting for the second confirmation');
    return { ok: true, quote: summary };
  }

  async #confirmSend(payload: unknown): Promise<ConfirmSendResultType> {
    this.#lastAskedAt = Date.now();
    const quoteId = parseConfirmSendRequest(payload);
    const current = this.#quote;
    // One shot: a confirm consumes the quote whether or not it matches.
    this.#quote = undefined;
    if (
      quoteId == null ||
      current == null ||
      current.summary.quoteId !== quoteId ||
      Date.now() > current.summary.expiresAt
    ) {
      log.info('confirmSend: refused, no such quote or it expired');
      return { ok: false, refusal: refusal('quote-expired') };
    }

    let sent: SendSnapshotType;
    try {
      sent = (await this.#call(
        { kind: 'confirm', quoteId },
        TIMEOUT_MS.confirm
      )) as SendSnapshotType;
    } catch (error) {
      const code = codeOf(error);
      const message = messageOf(error);
      log.warn(`confirmSend: not sent (${code}: ${redactForLog(message)})`);
      return {
        ok: false,
        refusal: refusal(
          code === 'quote-expired' ? 'quote-expired' : refusalKindFor(message)
        ),
      };
    }

    log.info(
      `confirmSend: transmitted ${sent.txids.length} transaction(s)` +
        (sent.saved ? '' : '; the wallet file could not be saved yet')
    );
    drop(this.#refresh({ forceSync: true }));
    return {
      ok: true,
      txids: [...sent.txids],
      saved: sent.saved,
      // What a payment notice in a chat carries, from what this process quoted
      // and the wallet sent - not from the window.
      chain: chainLabelOf(this.#network),
      memoHash: memoHashFor(current.summary.memo),
    };
  }

  async #cancelSend(): Promise<boolean> {
    this.#quote = undefined;
    if (this.#worker != null) {
      await this.#tryCall({ kind: 'cancel' }, TIMEOUT_MS.quick);
    }
    return true;
  }

  async #setNetwork(payload: unknown): Promise<SwarmWalletStateType> {
    const network = parseSetNetworkRequest(payload);
    if (!this.#canSwitchNetwork || network == null) {
      log.warn('setNetwork: refused');
      return this.#state();
    }
    if (network === this.#network) {
      return this.#state();
    }
    log.info(`setNetwork: ${this.#network} -> ${network}`);
    this.#network = network;
    ephemeralConfig.set(NETWORK_SETTING_NAME, network);
    this.#quote = undefined;

    const accountKey = this.#accountKey;
    if (accountKey != null && this.#status !== 'unavailable') {
      this.#open(accountKey, undefined, {
        switchFromOpen: this.#status === 'ready',
      });
    }
    return this.#state();
  }

  // Payments inside a chat (M3 wave 2) -----------------------------------------------

  /**
   * A new unified address of the open wallet, for one conversation: an address
   * reused with everybody links everybody who paid it. Takes nothing from the
   * window; answers the address and the chain it belongs to.
   */
  async #newAddress(payload: unknown): Promise<NewAddressResultType> {
    if (!parseNewAddressRequest(payload)) {
      throw new Error('Invalid request');
    }
    this.#lastAskedAt = Date.now();
    if (this.#status === 'offline') {
      return { ok: false, refusal: 'offline' };
    }
    if (this.#status !== 'ready') {
      return { ok: false, refusal: 'not-ready' };
    }
    let address: string;
    try {
      address = (await this.#call(
        { kind: 'new-address' },
        TIMEOUT_MS.quick
      )) as string;
    } catch (error) {
      log.warn(`newAddress: not made (${this.#describe(error)})`);
      return { ok: false, refusal: 'rejected' };
    }
    // What the wallet made must be an address of this network, or it is not
    // handed to a chat.
    if (
      typeof address !== 'string' ||
      !checkAddressFor(address, this.#network).accepted
    ) {
      log.warn('newAddress: the wallet answered something that is not ours');
      return { ok: false, refusal: 'rejected' };
    }
    log.info('newAddress: made a new address for a conversation');
    return { ok: true, address, chain: chainLabelOf(this.#network) };
  }

  /**
   * The wallet's own check of an address somebody shared in a chat, for the
   * network the wallet is on. Needs no open wallet.
   */
  async #checkAddress(payload: unknown): Promise<CheckAddressResultType> {
    const address = parseCheckAddressRequest(payload);
    if (address == null) {
      throw new Error('Invalid request');
    }
    const result = checkAddressFor(address, this.#network);
    log.info(
      `checkAddress: ${result.accepted ? 'accepted' : 'refused'} for ${result.chain}`
    );
    return result;
  }

  /**
   * What the open wallet knows about one transaction: the binding between a
   * payment notice in a chat and the payment itself. A notice is shown as
   * received only from this answer, with the amount from here.
   *
   * Asking counts as looking at the wallet: it keeps the wallet syncing, and
   * opens the signed-in account's wallet when it is not open yet.
   */
  async #findTransaction(payload: unknown): Promise<FindTransactionResultType> {
    const request = parseFindTransactionRequest(payload);
    if (request == null) {
      throw new Error('Invalid request');
    }
    this.#lastAskedAt = Date.now();
    this.#startTimer();

    const { accountKey } = request;
    if (
      accountKey != null &&
      this.#status !== 'unavailable' &&
      (this.#accountKey == null ||
        !sameAccountKey(accountKey, this.#accountKey))
    ) {
      this.#open(accountKey, undefined);
    }

    const chain = chainLabelOf(this.#network);
    if (this.#status !== 'ready' && this.#status !== 'offline') {
      return { status: 'wallet-not-ready', chain, wallet: this.#status };
    }
    let transfers: ReadonlyArray<FoundTransferType>;
    try {
      transfers = (await this.#call(
        { kind: 'find-transaction', txid: request.txid },
        TIMEOUT_MS.quick
      )) as ReadonlyArray<FoundTransferType>;
    } catch (error) {
      log.warn(`findTransaction: not read (${this.#describe(error)})`);
      return { status: 'wallet-not-ready', chain, wallet: this.#status };
    }
    if (transfers.length === 0) {
      return {
        status: 'not-found',
        chain,
        syncedHeight: this.#snapshot?.syncedHeight ?? null,
        serverHeight: this.#serverHeight,
      };
    }
    return summarizeFoundTransfers(transfers, request.memoHash, this.#network);
  }

  // Opening ---------------------------------------------------------------------

  /**
   * Opens the account's wallet, or creates it from the phrase. Starts the work
   * and returns at once; the state says how it is going.
   */
  #open(
    accountKey: Uint8Array<ArrayBuffer>,
    fromPhrase: { phrase: string; isNewPhrase: boolean } | undefined,
    {
      switchFromOpen = false,
      retryWhileOffline = false,
    }: { switchFromOpen?: boolean; retryWhileOffline?: boolean } = {}
  ): void {
    this.#generation += 1;
    const generation = this.#generation;
    this.#accountKey = accountKey;
    this.#quote = undefined;
    this.#syncRunning = false;
    this.#lastAttemptAt = Date.now();
    // A retry while offline stays 'offline' on screen until it succeeds: the
    // pane should not flicker to "opening" every thirty seconds.
    if (!retryWhileOffline) {
      this.#status = 'opening';
      this.#problem = null;
      this.#snapshot = undefined;
      this.#serverHeight = null;
      this.#genesisVerified = null;
    }

    drop(this.#runOpen(generation, accountKey, fromPhrase, switchFromOpen));
  }

  async #runOpen(
    generation: number,
    accountKey: Uint8Array<ArrayBuffer>,
    fromPhrase: { phrase: string; isNewPhrase: boolean } | undefined,
    switchFromOpen: boolean
  ): Promise<void> {
    try {
      const opened = await this.#openOrRestore(
        generation,
        accountKey,
        fromPhrase,
        switchFromOpen
      );
      if (!opened || generation !== this.#generation) {
        return;
      }
      this.#status = 'ready';
      log.info(
        `open: wallet open on ${this.#network}` +
          (this.#encryptedAtRest === false
            ? ', file NOT encrypted at rest (no OS keychain)'
            : '')
      );
      await this.#refresh({ forceSync: true });
    } catch (error) {
      if (generation !== this.#generation) {
        return;
      }
      const code = codeOf(error);
      const message = messageOf(error);
      const problem = classifyWalletFailure(code, message);
      this.#status = statusFor(problem);
      this.#problem = problem;
      // A restore's failure text can quote what it was given: for those, the
      // category only.
      log.warn(
        `open: ${problem}` +
          (fromPhrase == null ? ` (${code}: ${redactForLog(message)})` : '')
      );
    }
  }

  /** True when a wallet is now open; false when there is none to open. */
  async #openOrRestore(
    generation: number,
    accountKey: Uint8Array<ArrayBuffer>,
    fromPhrase: { phrase: string; isNewPhrase: boolean } | undefined,
    switchFromOpen: boolean
  ): Promise<boolean> {
    const encryptionKey = this.#walletKey();
    const { profile } = SWARM_WALLET_NETWORKS[this.#network];
    const location: WalletLocationType = {
      dataDir: join(this.#userDataPath, 'swarm-wallet'),
      walletName: walletFileNameFor(accountKey),
      chain: profile.chainLabel,
      server: this.#server(),
      encryptionKey,
    };
    try {
      const exists = (await this.#call(
        {
          kind: 'exists',
          dataDir: location.dataDir,
          walletName: location.walletName,
          chain: location.chain,
        },
        TIMEOUT_MS.quick
      )) as boolean;

      if (exists) {
        await this.#call({ kind: 'open', location }, TIMEOUT_MS.open);
      } else if (fromPhrase != null) {
        const birthdayHeight = fromPhrase.isNewPhrase
          ? await this.#birthdayForNewPhrase()
          : profile.activationHeight;
        await this.#call(
          {
            kind: 'restore',
            location,
            phrase: fromPhrase.phrase,
            birthdayHeight,
          },
          TIMEOUT_MS.open
        );
      } else if (switchFromOpen) {
        // The same seed on the other network, read inside the worker.
        await this.#call(
          {
            kind: 'switch',
            location,
            birthdayHeight: profile.activationHeight,
          },
          TIMEOUT_MS.open
        );
      } else {
        if (generation === this.#generation) {
          this.#status = 'no-wallet';
        }
        await this.#tryCall({ kind: 'close' }, TIMEOUT_MS.quick);
        log.info('open: no wallet for this account on this computer');
        return false;
      }
    } finally {
      // The worker has its own copy; this one is not kept.
      encryptionKey?.fill(0);
    }
    if (generation === this.#generation) {
      this.#encryptedAtRest = encryptionKey != null;
    }
    return true;
  }

  async #birthdayForNewPhrase(): Promise<number> {
    const { activationHeight } = SWARM_WALLET_NETWORKS[this.#network].profile;
    try {
      const height = (await this.#call(
        { kind: 'server-height', server: this.#server() },
        TIMEOUT_MS.quick
      )) as number;
      return Math.max(activationHeight, height - NEW_PHRASE_BIRTHDAY_MARGIN);
    } catch {
      // Scanning from the start is slower and always right.
      return activationHeight;
    }
  }

  // Keeping the state fresh ---------------------------------------------------------

  #startTimer(): void {
    if (this.#timer != null) {
      return;
    }
    this.#timer = setInterval(() => this.#tick(), 2_500);
    this.#timer.unref();
  }

  #tick(): void {
    const now = Date.now();
    if (now - this.#lastAskedAt > PANE_IDLE_AFTER_MS) {
      return;
    }
    if (this.#status === 'offline' && this.#snapshot == null) {
      // The wallet never opened: there is nothing to refresh, only an open to
      // try again, now and then.
      if (
        this.#accountKey != null &&
        now - this.#lastAttemptAt > RETRY_OFFLINE_EVERY_MS
      ) {
        this.#open(this.#accountKey, undefined, { retryWhileOffline: true });
      }
      return;
    }
    if (
      (this.#status === 'ready' || this.#status === 'offline') &&
      now - this.#lastRefreshAt > REFRESH_EVERY_MS
    ) {
      drop(this.#refresh({ forceSync: false }));
    }
  }

  async #refresh({ forceSync }: { forceSync: boolean }): Promise<void> {
    if (
      this.#refreshing ||
      (this.#status !== 'ready' && this.#status !== 'offline')
    ) {
      return;
    }
    this.#refreshing = true;
    const generation = this.#generation;
    this.#lastRefreshAt = Date.now();
    try {
      try {
        const server = (await this.#call(
          { kind: 'server' },
          TIMEOUT_MS.quick
        )) as ServerSnapshotType;
        if (generation !== this.#generation) {
          return;
        }
        this.#serverHeight = server.blockHeight;
        this.#genesisVerified = server.genesisVerified;
        this.#checkedAt = Date.now();
        if (this.#status === 'offline') {
          log.info('refresh: the light server answers again');
        }
        this.#status = 'ready';
        this.#problem = null;
      } catch (error) {
        if (generation !== this.#generation) {
          return;
        }
        const code = codeOf(error);
        const message = messageOf(error);
        if (code === 'timeout' || isNetworkFailure(message)) {
          if (this.#status !== 'offline') {
            log.info('refresh: the light server does not answer; offline');
          }
          this.#status = 'offline';
          this.#problem = 'offline';
        } else {
          log.warn(`refresh: server (${code}: ${redactForLog(message)})`);
        }
      }

      try {
        const snapshot = (await this.#call(
          { kind: 'snapshot' },
          TIMEOUT_MS.quick
        )) as WalletSnapshotType;
        if (generation === this.#generation) {
          this.#snapshot = snapshot;
          this.#syncRunning = snapshot.syncing;
        }
      } catch (error) {
        const message = messageOf(error);
        log.warn(`refresh: snapshot (${redactForLog(message)})`);
      }

      const now = Date.now();
      if (
        this.#status === 'ready' &&
        this.#snapshot?.syncing !== true &&
        (forceSync || now - this.#lastSyncAt > SYNC_EVERY_MS)
      ) {
        this.#lastSyncAt = now;
        const started = await this.#tryCall({ kind: 'sync' }, TIMEOUT_MS.quick);
        if (started === true && generation === this.#generation) {
          this.#syncRunning = true;
        }
      }
    } finally {
      this.#refreshing = false;
    }
  }

  #state(): SwarmWalletStateType {
    const snapshot = this.#snapshot;
    return {
      status: this.#status,
      problem: this.#problem,
      network: describeNetwork(this.#network, this.#server()),
      canSwitchNetwork: this.#canSwitchNetwork,
      serverHeight: this.#serverHeight,
      syncedHeight: snapshot?.syncedHeight ?? null,
      syncing: snapshot?.syncing ?? false,
      genesisVerified: this.#genesisVerified,
      encryptedAtRest: this.#encryptedAtRest,
      balance:
        snapshot == null
          ? null
          : {
              confirmedZat: snapshot.spendableZat,
              pendingZat: snapshot.pendingZat,
              totalZat: snapshot.totalZat,
            },
      address: snapshot?.address ?? null,
      transactions: snapshot == null ? [] : [...snapshot.transactions],
      checkedAt: this.#checkedAt,
    };
  }

  // The worker ------------------------------------------------------------------------

  #addonPath(): string {
    const file = `native-${process.platform}-${process.arch}.node`;
    const root = getAppRootDir();
    // A native module cannot be loaded from inside app.asar; electron-builder
    // unpacks every .node file (build.asarUnpack) beside it.
    const base = app.isPackaged
      ? root.replace(/app\.asar$/, 'app.asar.unpacked')
      : root;
    return join(base, 'vendor', 'swarm-wallet-native', file);
  }

  #ensureWorker(): Worker {
    if (this.#worker != null) {
      return this.#worker;
    }
    const addonPath = this.#addonPath();
    if (!existsSync(addonPath)) {
      throw codedError('addon-missing', 'no wallet addon in this build');
    }
    const worker = new Worker(
      join(getAppRootDir(), 'bundles', 'workers', 'swarmWallet.js'),
      { workerData: { addonPath } }
    );
    worker.on('message', (reply: WorkerReplyType) => {
      this.#inWorker.delete(reply.id);
      const pending = this.#calls.get(reply.id);
      if (pending == null) {
        // It timed out; whatever it says now is stale. SWARM change (0.1.3):
        // a recovery phrase that arrives after its caller gave up is zeroed,
        // not left to the garbage collector.
        if (reply.ok && reply.value instanceof Uint8Array) {
          reply.value.fill(0);
        }
        return;
      }
      this.#calls.delete(reply.id);
      clearTimeout(pending.timer);
      if (reply.ok) {
        pending.resolve(reply.value);
      } else {
        pending.reject(codedError(reply.error.code, reply.error.message));
      }
    });
    worker.on('error', error => {
      log.error(`worker error: ${redactForLog(error.message)}`);
    });
    worker.on('exit', code => {
      log.warn(`worker exited with code ${code}`);
      this.#worker = undefined;
      this.#inWorker.clear();
      this.#syncRunning = false;
      for (const [id, pending] of this.#calls) {
        clearTimeout(pending.timer);
        pending.reject(codedError('unexpected', 'the wallet worker stopped'));
        this.#calls.delete(id);
      }
    });
    this.#worker = worker;
    return worker;
  }

  /** `#call`, for the calls whose failure changes nothing. */
  async #tryCall(
    request: WorkerRequestType,
    timeoutMs: number
  ): Promise<unknown> {
    try {
      return await this.#call(request, timeoutMs);
    } catch {
      return undefined;
    }
  }

  #call(request: WorkerRequestType, timeoutMs: number): Promise<unknown> {
    return this.#post(request, timeoutMs).answer;
  }

  /** `#call`, also answering the request's id (SWARM change, 0.1.3). */
  #post(
    request: WorkerRequestType,
    timeoutMs: number
  ): { id: number | undefined; answer: Promise<unknown> } {
    let worker: Worker;
    try {
      worker = this.#ensureWorker();
    } catch (error) {
      return { id: undefined, answer: Promise.reject(error) };
    }
    const id = this.#nextCallId;
    this.#nextCallId += 1;
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#calls.delete(id);
        reject(codedError('timeout', `${request.kind} took too long`));
      }, timeoutMs);
      this.#calls.set(id, { resolve, reject, timer });
      this.#inWorker.add(id);
      worker.postMessage({ id, request });
    });
    return { id, answer };
  }

  // Settings and keys ---------------------------------------------------------------

  #initialNetwork(): SwarmWalletNetworkIdType {
    const candidates: Array<unknown> = [];
    if (this.#canSwitchNetwork) {
      candidates.push(ephemeralConfig.get(NETWORK_SETTING_NAME));
      if (config.has('swarmWalletNetwork')) {
        candidates.push(config.get('swarmWalletNetwork'));
      }
    }
    for (const candidate of candidates) {
      if (candidate === 'mainnet' || candidate === 'testnet') {
        return candidate;
      }
    }
    return 'mainnet';
  }

  #server(): string {
    return (
      this.#serverOverride ??
      SWARM_WALLET_NETWORKS[this.#network].profile.defaultServer
    );
  }

  /**
   * The 32-byte key the wallet file is sealed with, kept in the OS keychain
   * through Electron's safeStorage - the same arrangement as the message
   * database's key. When the keychain is unavailable (or is Linux's
   * `basic_text`, which is obfuscation rather than encryption) the wallet file
   * is left in the clear and the pane says so; a key written beside the file it
   * protects would only look like encryption.
   *
   * A fresh copy each time: the worker's store zeroes its copy on close and
   * this one is zeroed once handed over.
   */
  #walletKey(): Uint8Array<ArrayBuffer> | null {
    const isLinux = OS.isLinux();
    const backend = isLinux
      ? safeStorage.getSelectedStorageBackend()
      : undefined;
    const available =
      safeStorage.isEncryptionAvailable() &&
      (!isLinux || backend !== 'basic_text');

    const stored: unknown = userConfig.get(KEY_CONFIG_NAME);
    if (typeof stored === 'string') {
      if (!available) {
        throw codedError(
          'wallet-file',
          'the OS keychain that holds the wallet key is not available'
        );
      }
      const hex = safeStorage.decryptString(Buffer.from(stored, 'hex'));
      return new Uint8Array(Buffer.from(hex, 'hex'));
    }
    if (!available) {
      return null;
    }
    const key = randomBytes(32);
    userConfig.set(
      KEY_CONFIG_NAME,
      safeStorage.encryptString(key.toString('hex')).toString('hex')
    );
    log.info('created the wallet file key in the OS keychain');
    return new Uint8Array(key);
  }

  #describe(error: unknown): string {
    const code = codeOf(error);
    const message = messageOf(error);
    return `${code}: ${redactForLog(message)}`;
  }
}
