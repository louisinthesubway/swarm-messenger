// Copyright 2015 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import type { LocalizerType } from '../types/Util.std.ts';
import * as Errors from '../types/errors.std.ts';
import type { AnyToast } from '../types/Toast.dom.tsx';
import { ToastType } from '../types/Toast.dom.tsx';
import { createLogger } from '../logging/log.std.ts';
import { Button, ButtonVariant } from './Button.dom.tsx';
import { Spinner } from './Spinner.dom.tsx';
import { ToastManager } from './ToastManager.dom.tsx';
import { shouldNeverBeCalled } from '../util/shouldNeverBeCalled.std.ts';
import { useEscapeHandling } from '../hooks/useEscapeHandling.dom.ts';
import type { DebugLogSaveResult } from '../util/swarm/debugLogFile.std.ts';

const log = createLogger('DebugLogWindow');

enum LoadState {
  NotStarted,
  Started,
  Loaded,
  Saving,
}

// SWARM change (B5, 2026-09-29): upstream's window uploaded the log to a
// Signal service and showed the resulting link. Here the log stays on this
// computer: "Save to file" (primary), "Copy" (the log text itself) and
// "Close". There is no upload and no link.
export type PropsType = {
  closeWindow: () => unknown;
  saveLog: (text: string) => Promise<DebugLogSaveResult>;
  i18n: LocalizerType;
  fetchLogs: () => Promise<string>;
};

export function DebugLogWindow({
  closeWindow,
  saveLog,
  i18n,
  fetchLogs,
}: PropsType): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>(LoadState.NotStarted);
  const [logText, setLogText] = useState<string | undefined>();
  const [textAreaValue, setTextAreaValue] = useState<string>(
    i18n('icu:loading')
  );
  const [toast, setToast] = useState<AnyToast | undefined>();

  useEscapeHandling(closeWindow);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setLoadState(LoadState.Started);

    let shouldCancel = false;

    async function doFetchLogs() {
      const fetchedLogText = await fetchLogs();

      if (shouldCancel) {
        return;
      }

      setToast({ toastType: ToastType.LoadingFullLogs });
      setLogText(fetchedLogText);
      setLoadState(LoadState.Loaded);

      // This number is somewhat arbitrary; we want to show enough that it's
      // clear that we need to scroll, but not so many that things get slow.
      const linesToShow = Math.ceil(Math.min(window.innerHeight, 2000) / 5);
      const value = fetchedLogText.split(/\n/g, linesToShow).join('\n');

      setTextAreaValue(`${value}\n\n\n${i18n('icu:debugLogLogIsIncomplete')}`);
      setToast(undefined);
    }

    void doFetchLogs();

    return () => {
      shouldCancel = true;
    };
  }, [fetchLogs, i18n]);

  const handleSave = async () => {
    if (!logText) {
      return;
    }

    setLoadState(LoadState.Saving);
    let result: DebugLogSaveResult | undefined;
    try {
      result = await saveLog(logText);
    } catch (error) {
      log.error('Failed to save logs:', Errors.toLogFormat(error));
    }
    setLoadState(LoadState.Loaded);

    if (result === undefined) {
      setToast({ toastType: ToastType.DebugLogError });
    } else if (result === 'saved') {
      setToast({ toastType: ToastType.DebugLogSaved });
    }
  };

  const handleCopy = async () => {
    if (!logText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(logText);
      setToast({ toastType: ToastType.DebugLogCopied });
    } catch (error) {
      log.error('Failed to copy logs:', Errors.toLogFormat(error));
      setToast({ toastType: ToastType.DebugLogError });
    }
  };

  function closeToast() {
    setToast(undefined);
  }

  const hasLog = Boolean(logText);
  const isLoading = loadState === LoadState.Started;

  return (
    <div className="DebugLogWindow">
      <div>
        <div className="DebugLogWindow__title">{i18n('icu:debugLog')}</div>
        <p className="DebugLogWindow__subtitle">
          {i18n('icu:SwarmDebugLog__explanation')}
        </p>
      </div>
      {isLoading ? (
        <div className="DebugLogWindow__container">
          <Spinner svgSize="normal" />
        </div>
      ) : (
        <div className="DebugLogWindow__scroll_area">
          <pre className="DebugLogWindow__scroll_area__text">
            {textAreaValue}
          </pre>
        </div>
      )}
      <div className="DebugLogWindow__footer">
        <Button onClick={closeWindow} variant={ButtonVariant.Secondary}>
          {i18n('icu:close')}
        </Button>
        <Button
          disabled={!hasLog}
          onClick={handleCopy}
          variant={ButtonVariant.Secondary}
        >
          {i18n('icu:SwarmDebugLog__copy')}
        </Button>
        <Button
          disabled={!hasLog || loadState === LoadState.Saving}
          onClick={handleSave}
        >
          {i18n('icu:debugLogSave')}
        </Button>
      </div>
      <ToastManager
        changeLocation={shouldNeverBeCalled}
        OS="unused"
        hideToast={closeToast}
        i18n={i18n}
        onShowDebugLog={shouldNeverBeCalled}
        onUndoArchive={shouldNeverBeCalled}
        retryCallQualitySurvey={shouldNeverBeCalled}
        openFileInFolder={shouldNeverBeCalled}
        saveHeapSnapshot={shouldNeverBeCalled}
        setDidResumeDonation={shouldNeverBeCalled}
        toast={toast}
        containerWidthBreakpoint={null}
        expandNarrowLeftPane={shouldNeverBeCalled}
        isInFullScreenCall={false}
      />
    </div>
  );
}
