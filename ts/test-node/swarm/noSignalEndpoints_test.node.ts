// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1). This test is the guard rail for the one rule that cannot
// be allowed to rot: a SWARM Messenger build must not point at Signal. It walks
// config/ and ts/ looking for a Signal domain, ignoring the places where Signal
// is named on purpose - licence headers, the AGPL attribution, the guard that
// lists Signal's domains so it can refuse them, and the deep-link vocabulary
// (signal.me / signal.group / signal.link / signal.art) which is shared with the
// other SWARM clients and is renamed in a later milestone, not here.

import { assert } from 'chai';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

// The three names the brief calls out.
const FORBIDDEN = [/signal\.org/i, /signalcaptchas\.org/i, /whispersystems/i];

// Files allowed to mention them, each for a stated reason.
const ALLOWED_FILES = new Set(
  [
    // Lists Signal's own domains so the app can refuse to talk to them.
    'ts/util/swarm/endpointGuard.std.ts',
    // This test.
    'ts/test-node/swarm/noSignalEndpoints_test.node.ts',
    'ts/test-node/swarm/endpointGuard_test.node.ts',
    // Upstream deep-link vocabulary, shared with the other SWARM clients.
    'ts/util/signalRoutes.std.ts',
    'ts/test-node/util/signalRoutes_test.std.ts',
  ].map(p => p.split('/').join(sep))
);

function isLicenceOrAttributionLine(line: string): boolean {
  // "// Copyright 2017 Signal Messenger, LLC" and friends, in every comment
  // syntax the tree uses, plus the one attribution string we must keep.
  if (/Copyright \d{4} Signal Messenger, LLC/.test(line)) {
    return true;
  }
  if (line.includes('based on Signal Desktop by Signal Messenger, LLC')) {
    return true;
  }
  // A comment citing upstream source on GitHub. Not an endpoint: nothing is
  // fetched from it, and removing the citation would make the code harder to
  // follow. e.g. ts/groups.preload.ts pointing at Signal-Android.
  if (/^\s*(\/\/|\*|#)/.test(line) && line.includes('github.com/signalapp/')) {
    return true;
  }
  return false;
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function findOffences(dir: string, extensions: ReadonlyArray<string>) {
  const offences: Array<string> = [];
  for (const file of walk(join(ROOT, dir))) {
    if (!extensions.some(ext => file.endsWith(ext))) {
      continue;
    }
    const rel = relative(ROOT, file);
    if (ALLOWED_FILES.has(rel)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (isLicenceOrAttributionLine(line)) {
        return;
      }
      if (FORBIDDEN.some(pattern => pattern.test(line))) {
        offences.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return offences;
}

describe('SWARM: no Signal endpoints', () => {
  it('config/ never mentions a Signal domain', () => {
    const offences = findOffences('config', ['.json']);
    assert.deepStrictEqual(
      offences,
      [],
      `config/ must not reference Signal:\n${offences.join('\n')}`
    );
  });

  it('ts/ never mentions a Signal domain outside licences and the attribution', () => {
    const offences = findOffences('ts', ['.ts', '.tsx']);
    assert.deepStrictEqual(
      offences,
      [],
      `ts/ must not reference Signal:\n${offences.join('\n')}`
    );
  });

  it('keeps the AGPL attribution, word for word', () => {
    // The licence requires it and the About window is where a user sees it, so
    // this is the one place Signal must still be named. Removing or rewording
    // it is a licence breach, not a branding tidy-up.
    const attribution =
      'SWARM Messenger is based on Signal Desktop by Signal Messenger, LLC, ' +
      'AGPL-3.0';

    const messages = JSON.parse(
      readFileSync(join(ROOT, '_locales', 'en', 'messages.json'), 'utf8')
    );
    assert.strictEqual(
      messages['icu:SwarmAbout__attribution']?.messageformat,
      attribution
    );

    const about = readFileSync(
      join(ROOT, 'ts', 'components', 'About.dom.tsx'),
      'utf8'
    );
    assert.include(
      about,
      "i18n('icu:SwarmAbout__attribution')",
      'the About window must render the attribution'
    );
  });

  it('app/ never mentions a Signal domain outside licences', () => {
    const offences = findOffences('app', ['.ts', '.tsx']);
    assert.deepStrictEqual(
      offences,
      [],
      `app/ must not reference Signal:\n${offences.join('\n')}`
    );
  });

  it('build/optional-resources.json downloads nothing from Signal', () => {
    // The emoji search index, the large emoji font and the jumbomoji sheets are
    // fetched from these URLs at run time - the search index on every start.
    // Upstream's generator scripts write Signal's resource host here.
    const manifest: Record<string, { url: string }> = JSON.parse(
      readFileSync(join(ROOT, 'build', 'optional-resources.json'), 'utf8')
    );
    const offences = Object.entries(manifest)
      .filter(([, { url }]) => FORBIDDEN.some(pattern => pattern.test(url)))
      .map(([name, { url }]) => `${name}: ${url}`);
    assert.deepStrictEqual(
      offences,
      [],
      `optional resources must not come from Signal:\n${offences.join('\n')}`
    );
  });

  it('no packaged string, in any language, names a Signal domain', () => {
    // Only `messageformat` is packaged (build/compact-locales); descriptions
    // are translator notes and stay in the source tree.
    const offences: Array<string> = [];
    for (const locale of readdirSync(join(ROOT, '_locales'))) {
      const messages: Record<string, { messageformat?: string }> = JSON.parse(
        readFileSync(join(ROOT, '_locales', locale, 'messages.json'), 'utf8')
      );
      for (const [key, { messageformat }] of Object.entries(messages)) {
        if (
          typeof messageformat === 'string' &&
          FORBIDDEN.some(pattern => pattern.test(messageformat))
        ) {
          offences.push(`${locale} ${key}: ${messageformat}`);
        }
      }
    }
    assert.deepStrictEqual(
      offences,
      [],
      `translated strings must not name Signal's domains:\n${offences.join('\n')}`
    );
  });
});
