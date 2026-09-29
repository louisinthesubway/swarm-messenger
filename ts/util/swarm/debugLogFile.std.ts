// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B5, 2026-09-29). The debug log never leaves the computer on
// its own: upstream uploaded it to a Signal service, SWARM Messenger only saves
// it to a file the user picks (app/main.main.ts, 'show-debug-log-save-dialog').

/** What the save dialog did, as the debug log window is told. */
export type DebugLogSaveResult = 'saved' | 'canceled';

/**
 * The name the save dialog suggests, e.g.
 * `swarm-messenger-debug-log-2026-09-29.txt`, in the computer's own date.
 * The log is written as plain text, as upstream's "Save" did.
 */
export function getDebugLogFileName(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `swarm-messenger-debug-log-${year}-${month}-${day}.txt`;
}
