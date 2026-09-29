// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the rules the main process holds before the
// recovery phrase is shown, kept apart from Electron so a test can drive them.
//
//  - The words go to one window only: the reveal window the main process
//    opened, named by its webContents id. Any other sender is refused.
//  - Once. A second request from the same window is refused, whether or not
//    the first one succeeded.
//  - Only after a local confirmation: the operating system's (Touch ID,
//    Windows Hello) before the window opened, or the word "reveal" typed in the
//    window and a wait of three seconds, both checked here and not in the page.
//  - The main process keeps no copy. What it read from the wallet is zeroed as
//    soon as it is handed over; afterwards it holds a SHA-256 of the words,
//    which is enough to recognise them in a copy or save request (and, in
//    recoveryPhraseClipboard.node.ts, on the clipboard), and nothing that could
//    show them.
//
// A JavaScript string cannot be wiped. The byte buffers this file sees are
// zeroed; the strings the page and the wallet library make are dropped and left
// to the garbage collector. That is the limit of what an Electron app can do.

import { createHash, timingSafeEqual } from 'node:crypto';

import {
  RECOVERY_PHRASE_CONFIRM_DELAY_MS,
  RECOVERY_PHRASE_REVEAL_WORD,
} from '../../types/SwarmRecoveryPhrase.std.ts';
import type {
  RecoveryPhraseConfirmationType,
  RecoveryPhraseRevealRefusalType,
  RecoveryPhraseStatusType,
} from '../../types/SwarmRecoveryPhrase.std.ts';

/** SHA-256 of the words as UTF-8. Never logged, never sent anywhere. */
export function hashRecoveryPhrase(
  phrase: string | Uint8Array<ArrayBuffer>
): Buffer<ArrayBuffer> {
  return createHash('sha256')
    .update(typeof phrase === 'string' ? Buffer.from(phrase, 'utf8') : phrase)
    .digest();
}

/**
 * Hands the words to `send` and zeroes them, whatever `send` does. `send` must
 * copy synchronously - Electron's `webContents.send` serializes its arguments
 * before it returns - so the zeroing cannot reach the copy that is sent.
 */
export function deliverRecoveryPhraseOnce(
  bytes: Uint8Array<ArrayBuffer>,
  send: (bytes: Uint8Array<ArrayBuffer>) => void
): void {
  try {
    send(bytes);
  } finally {
    bytes.fill(0);
  }
}

type ArmedType = {
  senderId: number;
  confirmation: RecoveryPhraseConfirmationType;
  armedAt: number;
  state: 'waiting' | 'spent' | 'shown';
  hash: Buffer<ArrayBuffer> | undefined;
};

export type RecoveryPhraseAuthorizationType =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; refusal: RecoveryPhraseRevealRefusalType }>;

export class RecoveryPhraseGate {
  readonly #now: () => number;

  #armed: ArmedType | undefined;

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    this.#now = now;
  }

  /** A new reveal window, which alone may ask for the words, once. */
  arm({
    senderId,
    confirmation,
  }: {
    senderId: number;
    confirmation: RecoveryPhraseConfirmationType;
  }): void {
    this.#armed = {
      senderId,
      confirmation,
      armedAt: this.#now(),
      state: 'waiting',
      hash: undefined,
    };
  }

  /** The window is gone: nothing more is answered, and the hash is dropped. */
  disarm(): void {
    this.#armed?.hash?.fill(0);
    this.#armed = undefined;
  }

  isArmedFor(senderId: number): boolean {
    return this.#armed != null && this.#armed.senderId === senderId;
  }

  status(senderId: number): RecoveryPhraseStatusType | undefined {
    const armed = this.#armed;
    if (armed == null || armed.senderId !== senderId) {
      return undefined;
    }
    return {
      confirmation: armed.confirmation,
      waitMs:
        armed.confirmation === 'typed'
          ? Math.max(
              0,
              armed.armedAt + RECOVERY_PHRASE_CONFIRM_DELAY_MS - this.#now()
            )
          : 0,
    };
  }

  /**
   * Whether this window may have the words now. A yes is spent at once: the
   * next request is refused even if reading the wallet fails.
   */
  authorize(senderId: number, typed: string): RecoveryPhraseAuthorizationType {
    const armed = this.#armed;
    if (armed == null || armed.senderId !== senderId) {
      return { ok: false, refusal: 'used' };
    }
    if (armed.state !== 'waiting') {
      return { ok: false, refusal: 'used' };
    }
    if (armed.confirmation === 'typed') {
      if (typed.trim().toLowerCase() !== RECOVERY_PHRASE_REVEAL_WORD) {
        return { ok: false, refusal: 'not-confirmed' };
      }
      if (this.#now() - armed.armedAt < RECOVERY_PHRASE_CONFIRM_DELAY_MS) {
        return { ok: false, refusal: 'not-confirmed' };
      }
    }
    armed.state = 'spent';
    return { ok: true };
  }

  /** The words are on their way to the window; remember them by hash only. */
  shown(senderId: number, bytes: Uint8Array<ArrayBuffer>): void {
    const armed = this.#armed;
    if (armed == null || armed.senderId !== senderId) {
      return;
    }
    armed.state = 'shown';
    armed.hash = hashRecoveryPhrase(bytes);
  }

  /**
   * Whether `phrase` is exactly the words this window was shown. Copy and save
   * take the words from the window, and act only on these.
   */
  holdsPhrase(senderId: number, phrase: string): boolean {
    const armed = this.#armed;
    if (
      armed == null ||
      armed.senderId !== senderId ||
      armed.state !== 'shown' ||
      armed.hash == null
    ) {
      return false;
    }
    return timingSafeEqual(hashRecoveryPhrase(phrase), armed.hash);
  }
}
