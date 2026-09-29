// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { contextBridge, ipcRenderer } from 'electron';
import { MinimalSignalContext } from '../minimalContext.preload.ts';
import type { DebugLogSaveResult } from '../../util/swarm/debugLogFile.std.ts';

// SWARM change (B5, 2026-09-29): the window can save the log to a file and
// nothing else; the upload to a Signal service is gone.
function saveLog(logText: string): Promise<DebugLogSaveResult> {
  return ipcRenderer.invoke('show-debug-log-save-dialog', logText);
}

async function fetchLogs() {
  const data = await ipcRenderer.invoke('fetch-log');
  return ipcRenderer.invoke(
    'DebugLogs.getLogs',
    data,
    window.navigator.userAgent
  );
}

const Signal = {
  DebugLogWindowProps: {
    saveLog,
    fetchLogs,
  },
};
contextBridge.exposeInMainWorld('Signal', Signal);
contextBridge.exposeInMainWorld('SignalContext', MinimalSignalContext);
