// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM change (M1): sweep user-visible "Signal" wording out of
// _locales/en/messages.json, add the SWARM-only strings, and keep the one place
// where Signal must still be named: the licence attribution in the About window.
//
// Run with:  node scripts/swarm-rebrand-locale.mjs
// It is idempotent, and it is the only thing that should edit those strings, so a
// later upstream merge can be re-swept the same way.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = join(import.meta.dirname, '..');
const FILE = join(ROOT, '_locales', 'en', 'messages.json');

// Ordered: longest and most specific first.
const REPLACEMENTS = [
  [/Signal Desktop/g, 'SWARM Messenger'],
  [/Signal Messenger, LLC/g, 'SWARM'],
  [/Signal Messenger/g, 'SWARM Messenger'],
  [/Signal Connection/g, 'SWARM Connection'],
  [/Signal connection/g, 'SWARM connection'],
  [/Signal PIN/g, 'SWARM PIN'],
  [/Signal Backups/g, 'SWARM Backups'],
  [/Signal Backup/g, 'SWARM Backup'],
  [/Signal profile/g, 'SWARM profile'],
  [/Signal Profile/g, 'SWARM Profile'],
  [/Signal account/g, 'SWARM account'],
  [/Signal Account/g, 'SWARM Account'],
  [/Signal group/g, 'SWARM group'],
  [/Signal call/g, 'SWARM call'],
  [/Signal message/g, 'SWARM message'],
  [/support@signal\.org/g, 'support@swarm.green'],
  [/signal\.org\/download/g, 'swarm.green/download'],
  [/https:\/\/signal\.org\/legal/g, 'https://swarm.green/legal'],
  [/https:\/\/signal\.org/g, 'https://swarm.green'],
  [/signal\.org/g, 'swarm.green'],
  [/run signal with/g, 'run SWARM Messenger with'],
  // Bare "Signal" as the product name, last. Word-boundary so that
  // "SignalCI"-style identifiers are untouched (there are none in strings).
  [/\bSignal\b/g, 'SWARM Messenger'],
];

// Strings that a mechanical sweep cannot get right.
const OVERRIDES = {
  'icu:aboutSignalDesktop': 'About SWARM Messenger',
  'icu:signalDesktop': 'SWARM Messenger',
  'icu:welcomeToSignal': 'Welcome to SWARM Messenger',
  // Upstream: "Signal is a 501c3 nonprofit". False for SWARM, and this is where
  // the AGPL attribution belongs.
  'icu:signalNonProfit':
    'SWARM Messenger is based on Signal Desktop by Signal Messenger, LLC, AGPL-3.0',
  'icu:menuSetupAsStandalone': 'Create account on this computer',
  // Upstream names the signal.group link host, which is Signal's.
  'icu:GroupLinkManagement__CopyGroupLinkButtonLabel':
    'Copy group link to clipboard',
};

// SWARM-only strings.
const ADDITIONS = {
  'icu:SwarmInstall__create-account-here': {
    messageformat: 'Create account on this computer',
    description:
      'Shown on the first-run screen next to the linking QR code. Starts phone-number registration on this computer instead of linking to a phone.',
  },
  'icu:SwarmAbout__attribution': {
    messageformat:
      'SWARM Messenger is based on Signal Desktop by Signal Messenger, LLC, AGPL-3.0',
    description:
      'Licence attribution shown in the About window. Required by the AGPL-3.0; must never be removed or reworded.',
  },
  'icu:SwarmWallet__nav-label': {
    messageformat: 'Wallet',
    description: 'Left navigation label for the SWARM wallet tab.',
  },
  'icu:SwarmWallet__placeholder-title': {
    messageformat: 'Wallet',
    description: 'Title of the placeholder wallet pane.',
  },
  'icu:SwarmWallet__placeholder-body': {
    messageformat: 'Wallet arrives in the next build',
    description: 'Body of the placeholder wallet pane.',
  },
};

const raw = readFileSync(FILE, 'utf8');
const messages = JSON.parse(raw);

let swept = 0;
for (const [key, entry] of Object.entries(messages)) {
  if (key === 'smartling' || entry == null || typeof entry !== 'object') {
    continue;
  }
  if (typeof entry.messageformat !== 'string') {
    continue;
  }
  const before = entry.messageformat;
  let after = before;
  for (const [pattern, value] of REPLACEMENTS) {
    after = after.replace(pattern, value);
  }
  if (Object.hasOwn(OVERRIDES, key)) {
    after = OVERRIDES[key];
  }
  if (after !== before) {
    entry.messageformat = after;
    swept += 1;
  }
}

let added = 0;
for (const [key, entry] of Object.entries(ADDITIONS)) {
  const existing = messages[key];
  if (
    existing == null ||
    existing.messageformat !== entry.messageformat ||
    existing.description !== entry.description
  ) {
    messages[key] = entry;
    added += 1;
  }
}

writeFileSync(FILE, `${JSON.stringify(messages, null, 2)}\n`);

// Report what is left, so nobody has to guess.
const leftover = Object.entries(messages)
  .filter(
    ([key, entry]) =>
      key !== 'smartling' &&
      typeof entry?.messageformat === 'string' &&
      /signal/i.test(entry.messageformat)
  )
  .map(([key]) => key);

process.stdout.write(
  `swarm-rebrand-locale: swept ${swept} strings, wrote ${added} SWARM strings.\n`
);
process.stdout.write(
  `swarm-rebrand-locale: ${leftover.length} string(s) still mention Signal ` +
    `(expected: the licence attribution only): ${leftover.join(', ') || 'none'}\n`
);
