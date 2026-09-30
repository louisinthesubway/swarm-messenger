// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): what crosses between the main process and
// the small "Recovery phrase" window, and nothing else.
//
// This is the one place where the recovery phrase deliberately leaves the main
// process for a window: the person asked to see the 24 words that are their
// account and their money, so they can sign in again after being logged out.
// The main window never receives them. Only the reveal window does, over its
// own channels, once, after a local confirmation - see
// app/SwarmRecoveryPhraseExport.main.ts for the rules the main process holds.

import * as z from 'zod';

/** The reveal window's channels. Every one answers only that window. */
export const SWARM_RECOVERY_PHRASE_CHANNEL = {
  /** invoke: how the person confirms it is them in this window. */
  status: 'swarm-recovery-phrase:status',
  /** invoke: asks for the words; the answer says whether they are coming. */
  reveal: 'swarm-recovery-phrase:reveal',
  /** main → window, once: the words, as UTF-8 bytes. */
  phrase: 'swarm-recovery-phrase:phrase',
  /**
   * main → window, no payload (SWARM change, 0.1.3): the words were asked for
   * and the wallet is busy (syncing, or answering the Wallet tab); they follow
   * as soon as it is free.
   */
  busy: 'swarm-recovery-phrase:busy',
  /** invoke: put the words on the clipboard, cleared again after a minute. */
  copy: 'swarm-recovery-phrase:copy',
  /** invoke: write the words to a plain text file the person picks. */
  save: 'swarm-recovery-phrase:save',
} as const;

/**
 * The word typed to show the phrase when the operating system has no way to
 * confirm the person (Linux, a Windows PC without Windows Hello, a Mac without
 * Touch ID). Not translated: the main process compares it.
 */
export const RECOVERY_PHRASE_REVEAL_WORD = 'reveal';

/** How long the typed confirmation must wait before the words can be shown. */
export const RECOVERY_PHRASE_CONFIRM_DELAY_MS = 3_000;

/** How long the window stays open, before and again after the words are shown. */
export const RECOVERY_PHRASE_WINDOW_LIFETIME_MS = 2 * 60 * 1_000;

/** How long a copied phrase stays on the clipboard. */
export const RECOVERY_PHRASE_CLIPBOARD_CLEAR_MS = 60 * 1_000;

/** The file name "Save to file" suggests. */
export const RECOVERY_PHRASE_FILE_NAME = 'swarm-messenger-recovery-phrase.txt';

/**
 * How the person confirmed it is them. `os`: Touch ID or Windows Hello, before
 * the window opened. `typed`: they must type {@link RECOVERY_PHRASE_REVEAL_WORD}
 * in the window and wait {@link RECOVERY_PHRASE_CONFIRM_DELAY_MS}.
 */
export const RecoveryPhraseConfirmationSchema = z.enum(['os', 'typed']);
export type RecoveryPhraseConfirmationType = z.infer<
  typeof RecoveryPhraseConfirmationSchema
>;

export const RecoveryPhraseStatusSchema = z.object({
  confirmation: RecoveryPhraseConfirmationSchema,
  /** How long the typed confirmation still has to wait, from now. */
  waitMs: z.number().int().nonnegative(),
});
export type RecoveryPhraseStatusType = z.infer<
  typeof RecoveryPhraseStatusSchema
>;

export const RecoveryPhraseRevealRefusalSchema = z.enum([
  /** The typed word was wrong, or it came too early. */
  'not-confirmed',
  /** The words were shown already, or the window is no longer armed. */
  'used',
  /** The wallet could not give its words. Nothing was shown. */
  'unreadable',
  /**
   * SWARM change (0.1.3): the wallet stayed busy (syncing, or answering the
   * Wallet tab) for as long as the read waits. Nothing was shown.
   */
  'busy',
]);
export type RecoveryPhraseRevealRefusalType = z.infer<
  typeof RecoveryPhraseRevealRefusalSchema
>;

export const RecoveryPhraseRevealAnswerSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** When the window closes, from now. */
    closesInMs: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    refusal: RecoveryPhraseRevealRefusalSchema,
  }),
]);
export type RecoveryPhraseRevealAnswerType = z.infer<
  typeof RecoveryPhraseRevealAnswerSchema
>;

/** What the reveal window's preload hands its page. */
export type RecoveryPhraseRevealResultType =
  | Readonly<{ ok: true; words: ReadonlyArray<string>; closesInMs: number }>
  | Readonly<{ ok: false; refusal: RecoveryPhraseRevealRefusalType }>;

export const RecoveryPhraseCopyAnswerSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    /** When the clipboard is cleared, if it still holds the words. */
    clearsInMs: z.number().int().nonnegative(),
  }),
  z.object({ ok: z.literal(false) }),
]);
export type RecoveryPhraseCopyAnswerType = z.infer<
  typeof RecoveryPhraseCopyAnswerSchema
>;

export const RecoveryPhraseSaveAnswerSchema = z.enum([
  'saved',
  'cancelled',
  'failed',
]);
export type RecoveryPhraseSaveAnswerType = z.infer<
  typeof RecoveryPhraseSaveAnswerSchema
>;

/** The request the window sends with copy and save: the words it was shown. */
export const RecoveryPhraseWordsRequestSchema = z.object({
  phrase: z.string().max(1_000),
});

export const RecoveryPhraseRevealRequestSchema = z.object({
  confirmation: z.string().max(100),
});
