// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the recovery phrase window's preload. The
// only page that is ever sent the 24 words: they arrive once, as bytes, on
// their own channel (app/SwarmRecoveryPhraseExport.main.ts), are turned into
// words for the page, and the bytes are zeroed. Nothing here logs.

import { contextBridge, ipcRenderer } from 'electron';

import { MinimalSignalContext } from '../minimalContext.preload.ts';
import { drop } from '../../util/drop.std.ts';
import { parseUnknown } from '../../util/schemas.std.ts';
import {
  RecoveryPhraseCopyAnswerSchema,
  RecoveryPhraseRevealAnswerSchema,
  RecoveryPhraseSaveAnswerSchema,
  RecoveryPhraseStatusSchema,
  SWARM_RECOVERY_PHRASE_CHANNEL,
} from '../../types/SwarmRecoveryPhrase.std.ts';
import type {
  RecoveryPhraseCopyAnswerType,
  RecoveryPhraseRevealResultType,
  RecoveryPhraseSaveAnswerType,
  RecoveryPhraseStatusType,
} from '../../types/SwarmRecoveryPhrase.std.ts';

/** How long the words may take to follow a yes. They are sent before it. */
const PHRASE_WAIT_MS = 5_000;

async function getStatus(): Promise<RecoveryPhraseStatusType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_RECOVERY_PHRASE_CHANNEL.status
  );
  return parseUnknown(RecoveryPhraseStatusSchema, answer);
}

async function reveal(
  confirmation: string,
  onBusy?: () => void
): Promise<RecoveryPhraseRevealResultType> {
  let onPhrase: ((event: unknown, bytes: unknown) => void) | undefined;
  const phrase = new Promise<unknown>(resolve => {
    onPhrase = (_event, bytes) => resolve(bytes);
    ipcRenderer.once(SWARM_RECOVERY_PHRASE_CHANNEL.phrase, onPhrase);
  });
  // SWARM change (0.1.3): the main process says when the wallet is busy and
  // the words will take a while. The notice carries nothing.
  const onBusyNotice = () => onBusy?.();
  ipcRenderer.on(SWARM_RECOVERY_PHRASE_CHANNEL.busy, onBusyNotice);
  const stopListening = () => {
    if (onPhrase != null) {
      ipcRenderer.removeListener(
        SWARM_RECOVERY_PHRASE_CHANNEL.phrase,
        onPhrase
      );
    }
    ipcRenderer.removeListener(
      SWARM_RECOVERY_PHRASE_CHANNEL.busy,
      onBusyNotice
    );
  };

  let answer;
  try {
    const raw: unknown = await ipcRenderer.invoke(
      SWARM_RECOVERY_PHRASE_CHANNEL.reveal,
      { confirmation }
    );
    answer = parseUnknown(RecoveryPhraseRevealAnswerSchema, raw);
  } catch (error) {
    stopListening();
    throw error;
  }
  if (!answer.ok) {
    stopListening();
    return answer;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bytes = await Promise.race([
    phrase,
    new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), PHRASE_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  stopListening();
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, refusal: 'unreadable' };
  }
  const words = new TextDecoder().decode(bytes).split(' ');
  bytes.fill(0);
  return { ok: true, words, closesInMs: answer.closesInMs };
}

async function copy(
  words: ReadonlyArray<string>
): Promise<RecoveryPhraseCopyAnswerType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_RECOVERY_PHRASE_CHANNEL.copy,
    { phrase: words.join(' ') }
  );
  return parseUnknown(RecoveryPhraseCopyAnswerSchema, answer);
}

async function save(
  words: ReadonlyArray<string>
): Promise<RecoveryPhraseSaveAnswerType> {
  const answer: unknown = await ipcRenderer.invoke(
    SWARM_RECOVERY_PHRASE_CHANNEL.save,
    { phrase: words.join(' ') }
  );
  return parseUnknown(RecoveryPhraseSaveAnswerSchema, answer);
}

const Signal = {
  SwarmRecoveryPhraseWindowProps: {
    getStatus,
    reveal,
    copy,
    save,
    close: () => drop(MinimalSignalContext.executeMenuRole('close')),
  },
};
contextBridge.exposeInMainWorld('Signal', Signal);
contextBridge.exposeInMainWorld('SignalContext', MinimalSignalContext);
