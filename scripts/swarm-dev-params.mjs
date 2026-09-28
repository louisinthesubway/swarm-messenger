// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1): write throwaway, structurally valid server parameters
// into config/local-development.json so the user interface can be opened and
// worked on before the SWARM chat server exists.
//
//   node scripts/swarm-dev-params.mjs
//
// Why this is needed: the real serverPublicParams, genericServerPublicParams,
// backupServerPublicParams and serverTrustRoots come from the chat server, and
// until Opus M-B's staging server exists they are SWARM-PLACEHOLDER-* strings in
// config/. Those strings are not decodable, so libsignal throws while the app is
// still on its loading screen and no screen after it can be seen.
//
// What this writes is REAL cryptographic material - a freshly generated zkgroup
// server identity and a fresh trust root - but it belongs to nobody and no
// server holds the matching secrets. It cannot authenticate anything. It only
// lets the app finish starting.
//
// config/local-*.json is git-ignored, so this never reaches a commit or a build.
// Delete the file, or overwrite it from shared/staging-public-params.json, as
// soon as the real values exist. See docs/SWARM-CONFIG.md.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ServerSecretParams,
} = require('@signalapp/libsignal-client/zkgroup.js');
const { PrivateKey } = require('@signalapp/libsignal-client');

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'config', 'local-development.json');

function zkPublicParams() {
  const secret = ServerSecretParams.generate();
  return Buffer.from(secret.getPublicParams().serialize()).toString('base64');
}

function trustRoot() {
  return Buffer.from(PrivateKey.generate().getPublicKey().serialize()).toString(
    'base64'
  );
}

const contents = {
  _comment:
    'THROWAWAY development parameters written by scripts/swarm-dev-params.mjs. ' +
    'Nobody holds the matching secrets and nothing can be authenticated with ' +
    'them. They exist only so the user interface can be opened before the ' +
    'SWARM chat server does. Git-ignored. Replace with the real values from ' +
    'shared/staging-public-params.json - see docs/SWARM-CONFIG.md.',
  serverPublicParams: zkPublicParams(),
  genericServerPublicParams: zkPublicParams(),
  backupServerPublicParams: zkPublicParams(),
  serverTrustRoots: [trustRoot()],
};

writeFileSync(OUT, `${JSON.stringify(contents, null, 2)}\n`);

process.stdout.write(
  `swarm-dev-params: wrote ${OUT}\n` +
    'These are throwaway values for local UI work only. They authenticate\n' +
    'nothing. Delete the file or replace it with the real staging parameters\n' +
    'before testing against a server.\n'
);
