// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import { action } from '@storybook/addon-actions';

import type { Meta } from '@storybook/react';
import type { PropsType } from './DebugLogWindow.dom.tsx';
import { DebugLogWindow } from './DebugLogWindow.dom.tsx';
import { sleep } from '../util/sleep.std.ts';

const { i18n } = window.SignalContext;

// SWARM change (B5, 2026-09-29): the window saves or copies the log; there is
// no upload and no success screen with a link.
const createProps = (overrides: Partial<PropsType> = {}): PropsType => ({
  closeWindow: action('closeWindow'),
  saveLog: async (logs: string) => {
    action('saveLog')(logs);
    await sleep(1000);
    return 'saved';
  },
  i18n,
  fetchLogs: () => {
    action('fetchLogs')();
    return Promise.resolve('Sample logs');
  },
  ...overrides,
});

export default {
  title: 'Components/DebugLogWindow',
} satisfies Meta<PropsType>;

export function Basic(): JSX.Element {
  return <DebugLogWindow {...createProps()} />;
}

export function Loading(): JSX.Element {
  return (
    <DebugLogWindow
      {...createProps({
        fetchLogs: () => new Promise<string>(() => undefined),
      })}
    />
  );
}

export function SaveCanceled(): JSX.Element {
  return (
    <DebugLogWindow
      {...createProps({
        saveLog: async logs => {
          action('saveLog')(logs);
          return 'canceled';
        },
      })}
    />
  );
}

export function SaveFailed(): JSX.Element {
  return (
    <DebugLogWindow
      {...createProps({
        saveLog: async logs => {
          action('saveLog')(logs);
          throw new Error('Disk full');
        },
      })}
    />
  );
}
