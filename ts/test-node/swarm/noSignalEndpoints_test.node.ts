// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1). This test is the guard rail for the one rule that cannot
// be allowed to rot: a SWARM Messenger build must not point at Signal. It walks
// config/ and ts/ looking for a Signal domain, ignoring the places where Signal
// is named on purpose - licence headers, the guard that lists Signal's domains
// so it can refuse them, and the deep-link vocabulary (signal.me /
// signal.group / signal.link / signal.art) which is shared with the other SWARM
// clients and is renamed in a later milestone, not here. The AGPL-3.0
// attribution is in the Licences document (B2c), checked below.
//
// SWARM change (B3, 2026-09-29): that vocabulary is now only read. No source
// the app is built from may make a link on signal.me, signal.group, signal.art
// or signal.link, or a sgnl: link the app now makes as swarm:, and
// ts/util/signalRoutes.std.ts may name those hosts only in the route patterns
// listed below, which read links shared before.

import { assert } from 'chai';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  LICENCES_INTRODUCTION,
  buildLicencesDocument,
  escapeHtml,
} from '../../util/swarm/licencesDocument.std.ts';

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
  // syntax the tree uses.
  if (/Copyright \d{4} Signal Messenger, LLC/.test(line)) {
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

// A link on one of Signal's link hosts, written out (https://signal.me/...).
const SIGNAL_LINK_URL =
  /\b(?:https?:\/\/|sgnl:\/\/)(?:www\.)?signal\.(?:me|group|art|link)\b/i;
// The sgnl: app links the app now makes as swarm: (B3, MSG-P3).
const MOVED_SGNL_LINK =
  /sgnl:\/\/(?:addstickers|joingroup|linkdevice|show-conversation|start-call-lobby|show-window|cancel-presenting)\b/i;

function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

function findMadeSignalLinks(dir: string): Array<string> {
  const offences: Array<string> = [];
  for (const file of walk(join(ROOT, dir))) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) {
      continue;
    }
    const rel = relative(ROOT, file);
    const parts = rel.split(sep);
    // Tests feed old links in on purpose, to prove they still open.
    if (
      parts.some(part => part.startsWith('test-')) ||
      /_test\.[a-z.]+$/.test(rel)
    ) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (isCommentLine(line)) {
        return;
      }
      if (SIGNAL_LINK_URL.test(line) || MOVED_SGNL_LINK.test(line)) {
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

  it('ts/ never mentions a Signal domain outside licences', () => {
    const offences = findOffences('ts', ['.ts', '.tsx']);
    assert.deepStrictEqual(
      offences,
      [],
      `ts/ must not reference Signal:\n${offences.join('\n')}`
    );
  });

  it('keeps the AGPL-3.0 notices, word for word, in the Licences document', () => {
    // The licence requires the attribution and the offer of the source code.
    // Since B2c they are not a string in the About window: its "Licences"
    // entry opens build/licences.html, which buildLicencesDocument writes, and
    // this is the one place Signal is still named. Removing or rewording it is
    // a licence breach, not a branding tidy-up.
    assert.strictEqual(
      LICENCES_INTRODUCTION,
      'SWARM Messenger is free software under the GNU Affero General Public ' +
        'License, version 3. Source code: ' +
        'https://github.com/louisinthesubway/swarm-messenger. It is built on ' +
        'open-source software, including Signal Desktop, © Signal Messenger, ' +
        'LLC (AGPL-3.0), and the components listed below.'
    );

    const licence = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
    const acknowledgments = readFileSync(
      join(ROOT, 'ACKNOWLEDGMENTS.md'),
      'utf8'
    );
    const html = buildLicencesDocument({
      copyright: 'Copyright © 2026 SWARM',
      licence,
      acknowledgments,
    });
    const visible = html.replace(/<[^>]*>/g, '');
    assert.include(visible, escapeHtml(LICENCES_INTRODUCTION));
    assert.include(
      html,
      'Source code: <a href="https://github.com/louisinthesubway/swarm-messenger">'
    );
    assert.include(html, escapeHtml(licence), 'the whole AGPL-3.0 text');
    assert.include(
      html,
      escapeHtml(acknowledgments),
      'every third-party notice'
    );
    assert.isBelow(
      html.indexOf('Source code:'),
      html.indexOf('GNU AFFERO GENERAL PUBLIC LICENSE'),
      'the paragraph comes first, then the licence'
    );
    assert.isBelow(
      html.indexOf('GNU AFFERO GENERAL PUBLIC LICENSE'),
      html.indexOf('# Acknowledgments'),
      'then the third-party notices'
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

  it('no source makes a link on a Signal link host (B3)', () => {
    const offences = [
      ...findMadeSignalLinks('ts'),
      ...findMadeSignalLinks('app'),
      // The sticker pack creator window, packaged from sticker-creator/dist.
      ...findMadeSignalLinks(join('sticker-creator', 'src')),
    ];
    assert.deepStrictEqual(
      offences,
      [],
      `links must be made on swarm.green or as swarm:, not on Signal:\n${offences.join('\n')}`
    );
  });

  it('signalRoutes names Signal link hosts only to read old links (B3)', () => {
    const source = readFileSync(
      join(ROOT, 'ts', 'util', 'signalRoutes.std.ts'),
      'utf8'
    );
    const code = source
      .split('\n')
      .filter(line => !isCommentLine(line))
      .join('\n');
    const patterns = [
      ...code.matchAll(
        /_pattern\(\s*'([a-z]+:)',\s*'(signal\.(?:me|group|art|link))',\s*'([^']*)'/g
      ),
    ].map(([, protocol, host, path]) => `${protocol}//${host}${path}`);
    assert.deepStrictEqual(patterns, [
      'https://signal.me{/}?',
      'sgnl://signal.me{/}?',
      'https://signal.me{/}?',
      'sgnl://signal.me{/}?',
      'https://signal.group{/}?',
      'sgnl://signal.group{/}?',
      'https://signal.link/call{/}?',
      'sgnl://signal.link/call{/}?',
      'https://signal.art/addstickers{/}?',
    ]);
    // Anywhere else in the code a Signal link host may only appear in the
    // list of hostnames the router knows.
    const otherLines = code
      .split('\n')
      .filter(line => /signal\.(?:me|group|art|link)\b/.test(line))
      .filter(line => !/^\s*_pattern\(/.test(line))
      .map(line => line.trim());
    assert.deepStrictEqual(otherLines, [
      "'signal.me',",
      "'signal.group',",
      "'signal.link',",
      "'signal.art',",
    ]);
  });

  it('no English string shows a Signal link host or scheme (B3)', () => {
    const messages: Record<string, { messageformat?: string }> = JSON.parse(
      readFileSync(join(ROOT, '_locales', 'en', 'messages.json'), 'utf8')
    );
    const offences = Object.entries(messages)
      .filter(
        ([, { messageformat }]) =>
          typeof messageformat === 'string' &&
          /signal\.(?:me|group|art|link)\b|sgnl:/i.test(messageformat)
      )
      .map(([key, { messageformat }]) => `${key}: ${messageformat}`);
    assert.deepStrictEqual(offences, []);
  });
});
