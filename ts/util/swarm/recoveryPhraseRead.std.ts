// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (0.1.3, 2026-09-30): how long the recovery phrase read waits
// for a wallet that is busy, kept apart from Electron so a test can drive it.
//
// Why it has to wait. The words are read from the wallet addon (`get_seed`),
// never kept anywhere else, and that read goes through two queues it cannot
// jump:
//
//  - the wallet worker answers one request at a time, in arrival order
//    (ts/workers/swarmWalletWorker.node.ts), so the read starts only after the
//    Wallet pane's `server` and `snapshot` requests ahead of it have answered;
//  - inside the addon (swarm-wallet-core 0.2.0, native/src/lib.rs) `get_seed`
//    takes the light client's shared lock and then the wallet's read lock. A
//    running sync (pepper-sync) holds the wallet's write lock across its
//    requests to the light server, and `info_server` (the pane's `server`
//    request) holds the light client's exclusive lock across its own request.
//
// So right after the wallet opens, while its first sync runs - or whenever the
// light server is slow - the read can take far longer than the fifteen seconds
// every other quick call gets, and 0.1.2 gave up and said "The words could not
// be read". Nothing was wrong with the wallet; it was busy.
//
// The rule here: a wallet that is not busy answers well within `quickMs`, and
// if it has not, that is a real failure, as before. A wallet that is busy - a
// sync known to be running, or other requests still in the worker ahead of
// this one - is waited for, up to `busyWaitMs` in all, and the reveal window is
// told so after `busyNoticeMs`. Past that bound the answer is 'busy', which the
// window says in its own words: try again when the Wallet tab says it is up to
// date.
//
// Nothing here keeps, logs or copies the words. Bytes that arrive after this
// has given up are zeroed.

import { drop } from '../drop.std.ts';
import { codeOf, codedError } from '../../workers/swarmWalletProtocol.std.ts';

export const RECOVERY_PHRASE_READ_LIMITS = {
  /** What every quick wallet call gets; a wallet that is not busy answers well within it. */
  quickMs: 15_000,
  /** When the reveal window is told the wallet is busy, if it has not answered by then. */
  busyNoticeMs: 1_500,
  /** The longest the read waits in all, from the moment it is asked, for a busy wallet. */
  busyWaitMs: 3 * 60_000,
} as const;

export type RecoveryPhraseReadLimitsType = Readonly<{
  quickMs: number;
  busyNoticeMs: number;
  busyWaitMs: number;
}>;

export type RecoveryPhraseReadOutcomeType =
  | Readonly<{ type: 'read'; value: unknown }>
  /** The wallet was busy (syncing, or answering others) for the whole wait. */
  | Readonly<{ type: 'busy' }>
  /** A real failure. `error` names a reason, never the words. */
  | Readonly<{ type: 'failed'; error: unknown }>;

/**
 * What the wallet service answers the recovery phrase export: the words as
 * UTF-8 bytes, which the caller zeroes, or why there are none.
 */
export type RecoveryPhraseReadResultType =
  | Readonly<{ ok: true; bytes: Uint8Array<ArrayBuffer> }>
  | Readonly<{ ok: false; refusal: 'busy' | 'unreadable' }>;

export type WaitForRecoveryPhraseOptionsType = Readonly<{
  /**
   * Sends the read to the wallet worker. It must reject with an error whose
   * `code` is 'timeout' once `timeoutMs` has passed without an answer, as
   * SwarmWalletService's `#call` does.
   */
  read: (timeoutMs: number) => Promise<unknown>;
  /** Whether the wallet is busy now: a sync running, or requests ahead. */
  isBusy: () => boolean;
  /** Called at most once, when the read is waiting for a busy wallet. */
  onBusy?: () => void;
  limits?: RecoveryPhraseReadLimitsType;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}>;

/** Zeroes a byte answer nobody is going to use. */
function zeroIfBytes(value: unknown): void {
  if (value instanceof Uint8Array) {
    value.fill(0);
  }
}

export function waitForRecoveryPhrase({
  read,
  isBusy,
  onBusy,
  limits = RECOVERY_PHRASE_READ_LIMITS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: WaitForRecoveryPhraseOptionsType): Promise<RecoveryPhraseReadOutcomeType> {
  return new Promise(resolve => {
    let settled = false;
    let waitedForBusy = false;
    const timers: Array<unknown> = [];

    const settle = (outcome: RecoveryPhraseReadOutcomeType): void => {
      if (settled) {
        return;
      }
      settled = true;
      timers.forEach(timer => clearTimer(timer));
      resolve(outcome);
    };

    const pending = read(Math.max(limits.quickMs, limits.busyWaitMs));
    drop(
      (async () => {
        let value: unknown;
        try {
          value = await pending;
        } catch (error) {
          if (codeOf(error) === 'timeout' && waitedForBusy) {
            settle({ type: 'busy' });
          } else {
            settle({ type: 'failed', error });
          }
          return;
        }
        if (settled) {
          // Given up on already: nobody will show these.
          zeroIfBytes(value);
          return;
        }
        settle({ type: 'read', value });
      })()
    );

    timers.push(
      setTimer(() => {
        if (!settled && isBusy()) {
          waitedForBusy = true;
          onBusy?.();
        }
      }, limits.busyNoticeMs)
    );

    timers.push(
      setTimer(() => {
        if (settled) {
          return;
        }
        if (waitedForBusy || isBusy()) {
          // Busy now or when the window was told so: keep waiting, up to the
          // bound `read` was given.
          if (!waitedForBusy) {
            waitedForBusy = true;
            onBusy?.();
          }
          return;
        }
        // Not busy, and still no answer: what 0.1.2 did at this point.
        settle({
          type: 'failed',
          error: codedError('timeout', 'seed-phrase took too long'),
        });
      }, limits.quickMs)
    );
  });
}
