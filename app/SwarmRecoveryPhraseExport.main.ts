// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): "Recovery phrase" - showing a person the 24
// words that are their account and their money, so they can sign in again
// after being logged out, and letting them copy or save them.
//
//   Wallet pane (main window)
//     │  swarm-wallet:reveal-recovery-phrase         never answers the words
//     ▼
//   this file: Touch ID / Windows Hello if the OS has it, then opens
//     │        the reveal window (content-protected, modal, on top, no dev tools)
//     ▼
//   reveal window  ── swarm-recovery-phrase:* ──►  this file
//     types "reveal" and waits 3 s when the OS      answers only that window's
//     could not confirm the person                  webContents, once, then
//                                                   zeroes its copy of the words
//
// This is the one deliberate exception to "the renderer never receives a
// seed" (SwarmWalletService.main.ts). The rules that keep it narrow are in
// ts/util/swarm/recoveryPhraseGate.node.ts; the threat model is in
// docs/SWARM-CHANGES.md, section 3l.
//
// Logging: outcomes only. Never the words, never a file path.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { app, clipboard, dialog, ipcMain, systemPreferences } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import { createLogger } from '../ts/logging/log.std.ts';
import { drop } from '../ts/util/drop.std.ts';
import OS from '../ts/util/os/osMain.node.ts';
import { promptOSAuth } from '../ts/util/os/promptOSAuthMain.main.ts';
import {
  RecoveryPhraseGate,
  deliverRecoveryPhraseOnce,
} from '../ts/util/swarm/recoveryPhraseGate.node.ts';
import { RecoveryPhraseClipboard } from '../ts/util/swarm/recoveryPhraseClipboard.node.ts';
import { recoveryPhraseFileText } from '../ts/util/swarm/recoveryPhraseText.std.ts';
import { SWARM_WALLET_CHANNEL } from '../ts/types/SwarmWallet.std.ts';
import type { RevealRecoveryPhraseResultType } from '../ts/types/SwarmWallet.std.ts';
import {
  RECOVERY_PHRASE_FILE_NAME,
  RECOVERY_PHRASE_WINDOW_LIFETIME_MS,
  RecoveryPhraseRevealRequestSchema,
  RecoveryPhraseWordsRequestSchema,
  SWARM_RECOVERY_PHRASE_CHANNEL,
} from '../ts/types/SwarmRecoveryPhrase.std.ts';
import type {
  RecoveryPhraseConfirmationType,
  RecoveryPhraseCopyAnswerType,
  RecoveryPhraseRevealAnswerType,
  RecoveryPhraseSaveAnswerType,
  RecoveryPhraseStatusType,
} from '../ts/types/SwarmRecoveryPhrase.std.ts';
import type { LocalizerType } from '../ts/types/Util.std.ts';

const log = createLogger('SwarmRecoveryPhraseExport');

export type RecoveryPhraseSourceType = Readonly<{
  canExportRecoveryPhrase: () => boolean;
  /** UTF-8 bytes, which the caller zeroes; undefined when refused. */
  readRecoveryPhrase: () => Promise<Uint8Array<ArrayBuffer> | undefined>;
}>;

export type SwarmRecoveryPhraseExportOptionsType = Readonly<{
  getMainWindow: () => BrowserWindow | undefined;
  wallet: RecoveryPhraseSourceType;
  getI18n: () => LocalizerType;
  /**
   * Makes the reveal window, not yet loaded: sandboxed, content-protected,
   * modal to `parent` and on top of it, without dev tools, navigation or a
   * menu (app/main.main.ts, beside the About window).
   */
  createWindow: (parent: BrowserWindow) => Promise<BrowserWindow>;
  loadWindow: (window: BrowserWindow) => Promise<void>;
}>;

export class SwarmRecoveryPhraseExport {
  static create(
    options: SwarmRecoveryPhraseExportOptionsType
  ): SwarmRecoveryPhraseExport {
    return new SwarmRecoveryPhraseExport(options);
  }

  readonly #options: SwarmRecoveryPhraseExportOptionsType;

  readonly #gate = new RecoveryPhraseGate();

  readonly #clipboard = new RecoveryPhraseClipboard({
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: text => clipboard.writeText(text),
      clear: () => clipboard.clear(),
    },
  });

  #window: BrowserWindow | undefined;

  #opening = false;

  #closeTimer: NodeJS.Timeout | undefined;

  private constructor(options: SwarmRecoveryPhraseExportOptionsType) {
    this.#options = options;

    ipcMain.handle(SWARM_WALLET_CHANNEL.revealRecoveryPhrase, async event => {
      if (!this.#isMainWindow(event)) {
        log.warn('reveal: refused a caller that is not the main window');
        throw new Error('Not allowed');
      }
      return this.#open();
    });

    this.#handleWindow(SWARM_RECOVERY_PHRASE_CHANNEL.status, event =>
      this.#status(event)
    );
    this.#handleWindow(SWARM_RECOVERY_PHRASE_CHANNEL.reveal, (event, payload) =>
      this.#reveal(event, payload)
    );
    this.#handleWindow(SWARM_RECOVERY_PHRASE_CHANNEL.copy, (event, payload) =>
      this.#copy(event, payload)
    );
    this.#handleWindow(SWARM_RECOVERY_PHRASE_CHANNEL.save, (event, payload) =>
      this.#save(event, payload)
    );

    // Whatever the timer has not done yet, quitting does.
    app.on('will-quit', () => {
      if (this.#clipboard.clearAtQuit()) {
        log.info('quit: cleared the clipboard, which may have held the words');
      }
    });
  }

  // The main window's request ---------------------------------------------------

  #isMainWindow(event: IpcMainInvokeEvent): boolean {
    const mainWindow = this.#options.getMainWindow();
    if (mainWindow == null || mainWindow.isDestroyed()) {
      return false;
    }
    return (
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame
    );
  }

  async #open(): Promise<RevealRecoveryPhraseResultType> {
    const existing = this.#window;
    if (existing != null && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return { ok: true };
    }
    if (this.#opening) {
      return { ok: true };
    }
    if (!this.#options.wallet.canExportRecoveryPhrase()) {
      log.info('reveal: refused, no wallet is open');
      return { ok: false, refusal: 'not-ready' };
    }
    const parent = this.#options.getMainWindow();
    if (parent == null || parent.isDestroyed()) {
      return { ok: false, refusal: 'not-ready' };
    }

    this.#opening = true;
    try {
      const confirmation = await this.#confirmLocally();
      if (confirmation === 'refused') {
        log.info('reveal: the operating system did not confirm the person');
        return { ok: false, refusal: 'not-confirmed' };
      }

      const window = await this.#options.createWindow(parent);
      this.#window = window;
      const senderId = window.webContents.id;
      this.#gate.arm({ senderId, confirmation });
      this.#closeIn(window, RECOVERY_PHRASE_WINDOW_LIFETIME_MS);
      window.on('closed', () => {
        this.#gate.disarm();
        if (this.#closeTimer != null) {
          clearTimeout(this.#closeTimer);
          this.#closeTimer = undefined;
        }
        if (this.#window === window) {
          this.#window = undefined;
        }
        log.info('reveal: window closed');
      });
      log.info(`reveal: window opened (${confirmation} confirmation)`);
      drop(this.#options.loadWindow(window));
      return { ok: true };
    } finally {
      this.#opening = false;
    }
  }

  /**
   * Touch ID on a Mac that has it; Windows Hello through the app's existing
   * Windows user-consent module (@signalapp/windows-ucv, the check the
   * upstream app uses before it shows a backup key) on a PC that has it.
   * Everything else - Linux, and any machine where the OS cannot confirm the
   * person - gets the typed word and the wait, in the window.
   */
  async #confirmLocally(): Promise<RecoveryPhraseConfirmationType | 'refused'> {
    const i18n = this.#options.getI18n();
    if (OS.isMacOS()) {
      if (!systemPreferences.canPromptTouchID()) {
        return 'typed';
      }
      try {
        await systemPreferences.promptTouchID(
          i18n('icu:SwarmWallet__recovery--os-prompt--mac')
        );
        return 'os';
      } catch {
        return 'refused';
      }
    }
    if (OS.isWindows()) {
      const result = await promptOSAuth({
        reason: 'view-aep',
        localeString: i18n('icu:SwarmWallet__recovery--os-prompt--windows'),
      });
      if (result === 'success') {
        return 'os';
      }
      if (result === 'unauthorized') {
        return 'refused';
      }
      return 'typed';
    }
    return 'typed';
  }

  #closeIn(window: BrowserWindow, ms: number): void {
    if (this.#closeTimer != null) {
      clearTimeout(this.#closeTimer);
    }
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = undefined;
      if (!window.isDestroyed()) {
        log.info('reveal: window closed after its time was up');
        window.close();
      }
    }, ms);
  }

  // The reveal window's requests ------------------------------------------------------

  #handleWindow(
    channel: string,
    work: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ): void {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      const window = this.#window;
      if (
        window == null ||
        window.isDestroyed() ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !this.#gate.isArmedFor(event.sender.id)
      ) {
        log.warn(`${channel}: refused a caller that is not the reveal window`);
        throw new Error('Not allowed');
      }
      return work(event, payload);
    });
  }

  async #status(event: IpcMainInvokeEvent): Promise<RecoveryPhraseStatusType> {
    const status = this.#gate.status(event.sender.id);
    if (status == null) {
      throw new Error('Not allowed');
    }
    return status;
  }

  async #reveal(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<RecoveryPhraseRevealAnswerType> {
    const senderId = event.sender.id;
    const request = RecoveryPhraseRevealRequestSchema.safeParse(payload);
    const authorized = this.#gate.authorize(
      senderId,
      request.success ? request.data.confirmation : ''
    );
    if (!authorized.ok) {
      log.info(`reveal: refused (${authorized.refusal})`);
      return authorized;
    }

    const bytes = await this.#options.wallet.readRecoveryPhrase();
    if (bytes == null) {
      return { ok: false, refusal: 'unreadable' };
    }
    const window = this.#window;
    if (
      window == null ||
      window.isDestroyed() ||
      !this.#gate.isArmedFor(senderId)
    ) {
      // Closed while the wallet answered: nobody to show them to.
      bytes.fill(0);
      return { ok: false, refusal: 'used' };
    }

    this.#gate.shown(senderId, bytes);
    // Sent before this answer, on the same pipe, so the page has the words by
    // the time it reads the answer. `send` serializes at once; the bytes are
    // then zeroed and this process keeps only their hash.
    deliverRecoveryPhraseOnce(bytes, phrase =>
      event.sender.send(SWARM_RECOVERY_PHRASE_CHANNEL.phrase, phrase)
    );
    this.#closeIn(window, RECOVERY_PHRASE_WINDOW_LIFETIME_MS);
    log.info('reveal: the words were shown');
    return { ok: true, closesInMs: RECOVERY_PHRASE_WINDOW_LIFETIME_MS };
  }

  async #copy(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<RecoveryPhraseCopyAnswerType> {
    const request = RecoveryPhraseWordsRequestSchema.safeParse(payload);
    if (
      !request.success ||
      !this.#gate.holdsPhrase(event.sender.id, request.data.phrase)
    ) {
      log.warn('copy: refused, not the words this window was shown');
      return { ok: false };
    }
    try {
      const clearsInMs = await this.#clipboard.copy(request.data.phrase);
      log.info('copy: on the clipboard until it is cleared');
      return { ok: true, clearsInMs };
    } catch {
      log.warn('copy: the clipboard refused the words');
      return { ok: false };
    }
  }

  async #save(
    event: IpcMainInvokeEvent,
    payload: unknown
  ): Promise<RecoveryPhraseSaveAnswerType> {
    const request = RecoveryPhraseWordsRequestSchema.safeParse(payload);
    const window = this.#window;
    if (
      window == null ||
      !request.success ||
      !this.#gate.holdsPhrase(event.sender.id, request.data.phrase)
    ) {
      log.warn('save: refused, not the words this window was shown');
      return 'failed';
    }
    const i18n = this.#options.getI18n();
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: i18n('icu:SwarmWallet__recovery--save-dialog-title'),
        defaultPath: join(app.getPath('documents'), RECOVERY_PHRASE_FILE_NAME),
        filters: [
          {
            name: i18n('icu:SwarmWallet__recovery--save-file-type'),
            extensions: ['txt'],
          },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (canceled || filePath == null || filePath === '') {
        log.info('save: cancelled');
        return 'cancelled';
      }
      // Readable by this user only, where the file system has such a thing.
      await writeFile(
        filePath,
        recoveryPhraseFileText(
          request.data.phrase,
          i18n('icu:SwarmWallet__recovery--file-warning')
        ),
        { encoding: 'utf8', mode: 0o600 }
      );
      log.info('save: written to a plain text file the person chose');
      return 'saved';
    } catch (error) {
      // The category only: the error can name the path.
      log.warn(
        `save: not written (${error instanceof Error && 'code' in error ? String(error.code) : 'error'})`
      );
      return 'failed';
    }
  }
}
