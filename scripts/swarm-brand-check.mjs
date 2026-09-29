// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1): unpack a built SWARM Messenger and fail if Signal is
// still in it where it should not be.
//
//   node scripts/swarm-brand-check.mjs [releaseDir]   (default: ./release)
//
// The wallet team was burned by exactly this miss (W-2): a rebrand that looked
// finished until somebody opened the installed app. So this runs against the
// artefact, not the source tree.
//
// Two levels, on purpose:
//
//  FAIL - a Signal domain (signal.org, signalcaptchas.org, whispersystems)
//         anywhere in the app's own files. This is the thing that could make the
//         app talk to Signal, so there is no tolerance for it.
//  FAIL - user-visible "Signal" wording in the packaged English strings. No
//         exception since B2c (2026-09-29): the AGPL-3.0 attribution is not a
//         string any more, it is in the Licences document.
//  FAIL - a packaged app without the Licences document (build/licences.html,
//         opened from About > Licences), or one whose document lacks the
//         licence paragraph with the source-code offer, the AGPL-3.0 text or
//         the third-party notices. The AGPL-3.0 requires all three, so their
//         absence fails the build like a leak does.
//  EXCUSED - the endpoint guard's own refusal list (SIGNAL_HOST_SUFFIXES in
//         ts/util/swarm/endpointGuard.std.ts). It names Signal's domains so the
//         app can refuse them, which makes it the one place they must be in the
//         bundle. It is recognised by its first three entries in order, so any
//         other appearance of a Signal domain still fails.
//  REPORT - "Signal" inside bundled identifiers (window.SignalContext,
//         X-Signal-Agent, SignalSymbols, the @signalapp packages, the
//         signal.me/.group/.link/.art deep-link vocabulary). These are internal
//         or protocol-level names, not branding. They are listed so a human can
//         see them, and they do not fail the build.

import { createRequire } from 'node:module';
import process from 'node:process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, extname, basename } from 'node:path';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');

const releaseDir = process.argv[2] ?? 'release';

const FORBIDDEN_DOMAINS = [
  /signal\.org/i,
  /signalcaptchas\.org/i,
  /whispersystems/i,
];

// The Licences document (scripts/swarm-generate-licences.mjs writes it,
// ts/util/swarm/licencesDocument.std.ts is its source) and what it must say.
// The paragraph is repeated here word for word on purpose: a change to the
// licence text has to be made in both places, deliberately.
const LICENCES_DOCUMENT = 'build/licences.html';
const LICENCES_MUST_CONTAIN = [
  [
    'the licence paragraph with the offer of the source code',
    'SWARM Messenger is free software under the GNU Affero General Public ' +
      'License, version 3. Source code: ' +
      'https://github.com/louisinthesubway/swarm-messenger. It is built on ' +
      'open-source software, including Signal Desktop, © Signal Messenger, ' +
      'LLC (AGPL-3.0), and the components listed below.',
  ],
  ['the AGPL-3.0 text (LICENSE)', 'GNU AFFERO GENERAL PUBLIC LICENSE'],
  ['the third-party notices (ACKNOWLEDGMENTS.md)', '# Acknowledgments'],
];

// Paths inside the app that may legitimately mention Signal.
function isExcusedPath(relPath) {
  const p = relPath.split('\\').join('/');
  return (
    p.startsWith('node_modules/') ||
    /(^|\/)(LICENSE|LICENCE|COPYING|NOTICE)([.-][^/]*)?$/i.test(p) ||
    /ACKNOWLEDGMENTS\.md$/i.test(p) ||
    /NOTICE-SWARM\.md$/i.test(p) ||
    p === LICENCES_DOCUMENT
  );
}

// The document's visible text: tags dropped, the few entities it uses decoded.
function visibleText(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.html',
  '.css',
  '.txt',
  '.md',
  '.svg',
  '.plist',
  '.policy',
  '.desktop',
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// electron-builder names the unpacked app directory after the platform, plus
// the architecture for every architecture but x64: win-unpacked,
// linux-unpacked, mac (x64), and win-arm64-unpacked, linux-arm64-unpacked,
// mac-arm64, mac-universal. SWARM's macOS build is arm64, so it lands in
// mac-arm64. Every packaged app found is checked, not only the first.
function findPackagedApps() {
  const macApp = dir =>
    join(
      releaseDir,
      dir,
      'SWARM Messenger.app',
      'Contents',
      'Resources',
      'app.asar'
    );
  const candidates = [
    join(releaseDir, 'win-unpacked', 'resources', 'app.asar'),
    join(releaseDir, 'win-arm64-unpacked', 'resources', 'app.asar'),
    join(releaseDir, 'linux-unpacked', 'resources', 'app.asar'),
    join(releaseDir, 'linux-arm64-unpacked', 'resources', 'app.asar'),
    macApp('mac'),
    macApp('mac-arm64'),
    macApp('mac-universal'),
  ];
  return candidates.filter(candidate => existsSync(candidate));
}

const domainOffences = [];
const stringOffences = [];
const licenceOffences = [];
const internalMentions = new Map();

// The endpoint guard's refusal list, as the bundler writes it: one entry per
// line in a development bundle, all on one minified line in a production one,
// with whichever quotes the bundler chose. Matching the first three entries in
// order keeps this narrow: a URL or a lone domain anywhere else still fails.
const GUARD_LIST =
  /(["'`])signal\.org\1\s*,\s*(["'`])signalcaptchas\.org\2\s*,\s*(["'`])whispersystems\.org\3/g;
let excusedGuardLists = 0;

function scanText(relPath, text) {
  const withoutGuardList = text.replace(GUARD_LIST, () => {
    excusedGuardLists += 1;
    return '<endpoint guard refusal list>';
  });
  const lines = withoutGuardList.split('\n');
  lines.forEach((line, index) => {
    if (FORBIDDEN_DOMAINS.some(pattern => pattern.test(line))) {
      const where = `${relPath}:${index + 1}`;
      // Bundled code is minified into very long lines - show a window.
      const match = line.match(
        /.{0,60}(signal\.org|signalcaptchas\.org|whispersystems).{0,60}/i
      );
      domainOffences.push(`${where}: ...${match ? match[0] : line.trim()}...`);
    }
    if (/Signal/.test(line)) {
      internalMentions.set(relPath, (internalMentions.get(relPath) ?? 0) + 1);
    }
  });
}

function scanEnglishStrings(relPath, text) {
  // Packaged locales are compact: _locales/en/values.json is an array of
  // strings, keys.json is the matching array of keys.
  let values;
  try {
    values = JSON.parse(text);
  } catch {
    return;
  }
  const list = Array.isArray(values) ? values : Object.values(values);
  for (const value of list) {
    if (typeof value !== 'string') {
      continue;
    }
    if (/\bSignal\b/.test(value)) {
      stringOffences.push(`${relPath}: ${value.slice(0, 160)}`);
    }
  }
}

// Checks the Licences document of one unpacked app (see LICENCES_MUST_CONTAIN).
async function checkLicencesDocument(dir, label) {
  const where =
    label === undefined ? LICENCES_DOCUMENT : `${label}/${LICENCES_DOCUMENT}`;
  const documentPath = join(dir, ...LICENCES_DOCUMENT.split('/'));
  if (!existsSync(documentPath)) {
    licenceOffences.push(
      `${where}: missing (About > Licences would open nothing)`
    );
    return;
  }
  const text = visibleText(await readFile(documentPath, 'utf8'));
  const lacking = LICENCES_MUST_CONTAIN.filter(
    ([, needle]) => !text.includes(needle)
  );
  for (const [what] of lacking) {
    licenceOffences.push(`${where}: lacks ${what}`);
  }
  if (lacking.length > 0) {
    return;
  }
  process.stdout.write(
    `swarm-brand-check: ${where} is in the app (${text.length} characters ` +
      'of text: the licence paragraph, the AGPL-3.0 text, the third-party ' +
      'notices)\n'
  );
}

// Unpacks one app.asar and scans it. `label` prefixes every reported path when
// more than one packaged app is checked, so a finding names its platform.
async function scanApp(appAsar, label) {
  const dir = await mkdtemp(join(tmpdir(), 'swarm-brand-check-'));
  process.stdout.write(`swarm-brand-check: unpacking ${appAsar}\n`);
  asar.extractAll(appAsar, dir);

  let scanned = 0;
  try {
    await checkLicencesDocument(dir, label);
    for await (const file of walk(dir)) {
      const rel = relative(dir, file);
      if (isExcusedPath(rel)) {
        continue;
      }
      const ext = extname(file).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) {
        continue;
      }
      const info = await stat(file);
      if (info.size > 32 * 1024 * 1024) {
        continue;
      }
      const text = await readFile(file, 'utf8');
      const where = label === undefined ? rel : `${label}/${rel}`;
      scanned += 1;
      scanText(where, text);
      if (
        basename(file) === 'values.json' &&
        rel.split('\\').join('/').includes('_locales/en/')
      ) {
        scanEnglishStrings(where, text);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return scanned;
}

async function main() {
  const appAsars = findPackagedApps();
  if (appAsars.length === 0) {
    process.stderr.write(
      `swarm-brand-check: no packaged app found under ${releaseDir}/. ` +
        'Run `pnpm run build` first.\n'
    );
    process.exit(2);
  }

  let scanned = 0;
  for (const appAsar of appAsars) {
    const label =
      appAsars.length === 1
        ? undefined
        : relative(releaseDir, appAsar).split(/[\\/]/)[0];
    // One archive at a time keeps the temporary copy small.
    // oxlint-disable-next-line no-await-in-loop
    scanned += await scanApp(appAsar, label);
  }

  process.stdout.write(`swarm-brand-check: scanned ${scanned} text files\n`);
  process.stdout.write(
    `swarm-brand-check: excused ${excusedGuardLists} copy(ies) of the ` +
      "endpoint guard's refusal list (the domains the app refuses to contact)\n"
  );

  if (internalMentions.size > 0) {
    const total = [...internalMentions.values()].reduce((a, b) => a + b, 0);
    process.stdout.write(
      `swarm-brand-check: ${total} internal mention(s) of "Signal" in ` +
        `${internalMentions.size} file(s) - identifiers, headers and the ` +
        'deep-link vocabulary, not branding:\n'
    );
    for (const [file, count] of [...internalMentions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)) {
      process.stdout.write(`  ${count.toString().padStart(6)}  ${file}\n`);
    }
  }

  let failed = false;

  if (licenceOffences.length > 0) {
    failed = true;
    process.stderr.write(
      '\nswarm-brand-check FAILED: the Licences document is not what the ' +
        'AGPL-3.0 requires:\n'
    );
    for (const offence of licenceOffences) {
      process.stderr.write(`  ${offence}\n`);
    }
  }

  if (domainOffences.length > 0) {
    failed = true;
    process.stderr.write(
      `\nswarm-brand-check FAILED: ${domainOffences.length} Signal domain ` +
        'reference(s) in the packaged app:\n'
    );
    for (const offence of domainOffences.slice(0, 40)) {
      process.stderr.write(`  ${offence}\n`);
    }
    if (domainOffences.length > 40) {
      process.stderr.write(`  ... and ${domainOffences.length - 40} more\n`);
    }
  }

  if (stringOffences.length > 0) {
    failed = true;
    process.stderr.write(
      `\nswarm-brand-check FAILED: ${stringOffences.length} English string(s) ` +
        'still say "Signal":\n'
    );
    for (const offence of stringOffences.slice(0, 40)) {
      process.stderr.write(`  ${offence}\n`);
    }
  }

  if (failed) {
    process.exit(1);
  }

  process.stdout.write(
    'swarm-brand-check: OK - no Signal domains, no English string names ' +
      'Signal, and the Licences document carries the licence paragraph, the ' +
      'AGPL-3.0 text and the third-party notices.\n'
  );
}

await main();
