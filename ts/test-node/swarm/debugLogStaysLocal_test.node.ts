// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B5, 2026-09-29). Upstream's "Submit debug log" uploaded the
// log to a Signal service and handed back a link; the call-quality survey and
// the key-verification error dialog did the same. In SWARM Messenger the log
// stays on this computer: the debug log window saves it to a file or copies the
// text, and nothing else. These checks keep the upload from coming back with an
// upstream merge. (noSignalEndpoints_test.node.ts rejects the upload host.)

import { assert } from 'chai';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { getDebugLogFileName } from '../../util/swarm/debugLogFile.std.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const THIS_FILE = [
  'ts',
  'test-node',
  'swarm',
  'debugLogStaysLocal_test.node.ts',
].join(sep);

// Upstream's upload path: the IPC channel, the module, the preload function
// and the link it produced.
const UPLOAD_NAMES = [
  'DebugLogs.upload',
  'uploadDebugLog',
  'uploadLogs',
  'publishedLogURL',
  'debugLogUrl = await',
];

// Deleted from every language together with the upload.
const DELETED_KEYS = [
  'icu:submitDebugLog',
  'icu:debugLogExplanation',
  'icu:debugLogExplanation--close',
  'icu:debugLogSuccess',
  'icu:debugLogSuccessNextSteps',
  'icu:debugLogLinkCopied',
  'icu:debugLogError',
  'icu:debugLogCopy',
  'icu:reportIssue',
];

// What the debug log window and its menu item show.
const WINDOW_KEYS = [
  'icu:debugLog',
  'icu:debugLogSave',
  'icu:debugLogLogIsIncomplete',
  'icu:SwarmDebugLog__menu',
  'icu:SwarmDebugLog__explanation',
  'icu:SwarmDebugLog__copy',
  'icu:SwarmDebugLog__copied',
  'icu:SwarmDebugLog__saved',
  'icu:SwarmDebugLog__error',
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      yield* walk(full);
    } else if (/\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

type MessagesType = Record<string, { messageformat?: string }>;

function readMessages(locale: string): MessagesType {
  return JSON.parse(
    readFileSync(join(ROOT, '_locales', locale, 'messages.json'), 'utf8')
  );
}

describe('SWARM: the debug log stays on this computer', () => {
  it('suggests swarm-messenger-debug-log-<date>.txt', () => {
    assert.strictEqual(
      getDebugLogFileName(new Date(2026, 8, 29, 23, 59, 59)),
      'swarm-messenger-debug-log-2026-09-29.txt'
    );
    assert.strictEqual(
      getDebugLogFileName(new Date(2027, 0, 5, 0, 0, 0)),
      'swarm-messenger-debug-log-2027-01-05.txt'
    );
  });

  it('has no upload path left in app/ or ts/', () => {
    const offences: Array<string> = [];
    for (const dir of ['app', 'ts']) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (rel === THIS_FILE) {
          continue;
        }
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (UPLOAD_NAMES.some(name => line.includes(name))) {
            offences.push(`${rel}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    assert.deepStrictEqual(
      offences,
      [],
      `the debug log must not be uploaded:\n${offences.join('\n')}`
    );
  });

  it('saves through the save dialog and nothing else', () => {
    const preload = readFileSync(
      join(ROOT, 'ts', 'windows', 'debuglog', 'preload.preload.ts'),
      'utf8'
    );
    const channels = [
      ...preload.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g),
    ].map(match => match[1]);
    assert.sameMembers(channels, [
      'show-debug-log-save-dialog',
      'fetch-log',
      'DebugLogs.getLogs',
    ]);
  });

  it('says in the window that nothing is sent', () => {
    const en = readMessages('en');
    for (const key of WINDOW_KEYS) {
      const text = en[key]?.messageformat;
      assert.isString(text, `${key} exists`);
      assert.notMatch(
        text ?? '',
        /upload|submit|post(ed)? online|link/i,
        `${key} must not promise an upload`
      );
    }
    assert.strictEqual(en['icu:debugLog']?.messageformat, 'Debug log');
    assert.strictEqual(en['icu:debugLogSave']?.messageformat, 'Save to file');
    assert.strictEqual(
      en['icu:SwarmDebugLog__menu']?.messageformat,
      'Save debug log…'
    );
    assert.include(
      en['icu:SwarmDebugLog__explanation']?.messageformat,
      'Nothing is sent'
    );
  });

  it('dropped the upload strings from every language', () => {
    const offences: Array<string> = [];
    for (const locale of readdirSync(join(ROOT, '_locales'))) {
      const messages = readMessages(locale);
      for (const key of DELETED_KEYS) {
        if (Object.hasOwn(messages, key)) {
          offences.push(`${locale} ${key}`);
        }
      }
    }
    assert.deepStrictEqual(offences, []);
  });
});
