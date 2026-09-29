// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the recovery phrase on the clipboard, for
// one minute at most. Kept apart from Electron so a test can drive it.

import { timingSafeEqual } from 'node:crypto';

import { RECOVERY_PHRASE_CLIPBOARD_CLEAR_MS } from '../../types/SwarmRecoveryPhrase.std.ts';
import { hashRecoveryPhrase } from './recoveryPhraseGate.node.ts';

/** Electron's clipboard, whose reads and writes are asynchronous. */
export type ClipboardLikeType = Readonly<{
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
  clear: () => void;
}>;

/**
 * Puts the words on the clipboard and takes them off again after a minute -
 * but only if they are still what the clipboard holds: whatever the person
 * copied since is theirs and is left alone. The main process remembers the
 * words by their SHA-256 only.
 */
export class RecoveryPhraseClipboard {
  readonly #clipboard: ClipboardLikeType;

  readonly #schedule: (work: () => void, ms: number) => () => void;

  #hash: Buffer<ArrayBuffer> | undefined;

  #cancel: (() => void) | undefined;

  constructor({
    clipboard,
    schedule = (work, ms) => {
      const timer = setTimeout(work, ms);
      return () => clearTimeout(timer);
    },
  }: {
    clipboard: ClipboardLikeType;
    schedule?: (work: () => void, ms: number) => () => void;
  }) {
    this.#clipboard = clipboard;
    this.#schedule = schedule;
  }

  /** Copies, and answers how long until the clipboard is cleared. */
  async copy(phrase: string): Promise<number> {
    this.#forget();
    await this.#clipboard.writeText(phrase);
    this.#hash = hashRecoveryPhrase(phrase);
    this.#cancel = this.#schedule(() => {
      void this.clearIfStillHeld();
    }, RECOVERY_PHRASE_CLIPBOARD_CLEAR_MS);
    return RECOVERY_PHRASE_CLIPBOARD_CLEAR_MS;
  }

  /** Clears the clipboard if it still holds the words; the timer's work. */
  async clearIfStillHeld(): Promise<boolean> {
    const hash = this.#hash;
    if (hash == null) {
      return false;
    }
    let text: string;
    try {
      text = await this.#clipboard.readText();
    } catch {
      text = '';
    }
    if (this.#hash !== hash) {
      // Copied again, or cleared at quit, while the clipboard was read.
      return false;
    }
    // Taken out before #forget, which would zero it before it is compared.
    this.#hash = undefined;
    this.#forget();
    const held = timingSafeEqual(hashRecoveryPhrase(text), hash);
    hash.fill(0);
    if (held) {
      this.#clipboard.clear();
    }
    return held;
  }

  /**
   * At quit there is no time to read the clipboard back, so while the words
   * may still be on it - within the minute - it is cleared without looking.
   * Something copied since then is lost too; the words must not outlive the
   * app on the clipboard.
   */
  clearAtQuit(): boolean {
    if (this.#hash == null) {
      return false;
    }
    this.#forget();
    this.#clipboard.clear();
    return true;
  }

  #forget(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    this.#hash?.fill(0);
    this.#hash = undefined;
  }
}
