// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1): copy the server-generated public parameters into
// config/, replacing the SWARM-PLACEHOLDER-* values, so that wiring them in is
// one command and cannot be half-done.
//
//   node scripts/swarm-import-params.mjs [path-to-staging-public-params.json]
//
// The default path is D:\swarm-messenger\shared\staging-public-params.json, the
// file the server fork produces. Its format is documented in the server repo at
// docs/STAGING.md section 5a:
//
//   {
//     "schema": "swarm-messenger/staging-public-params/1",
//     "endpoints": { "chat": ..., "cdn": ..., "registration": null, "sfu": null },
//     "serverPublicParams": "<900 base64 chars>",
//     "genericServerPublicParams": "<300 base64 chars>",
//     "backupServerPublicParams": "<300 base64 chars>",
//     "callingServerPublicParams": "...",          // = genericServerPublicParams
//     "callingServerPublicParamsPreV101": "...",   // not used by the desktop
//     "serverTrustRoots": ["<44 base64 chars>"],   // a LIST, for rotation
//     "registrationCaCertificatePem": "..."        // internal CA, clients skip it
//   }
//
// The desktop uses four of those fields. genericServerPublicParams is the
// server's CALLING set (callingZkConfig): Signal Desktop verifies call-link
// credentials with it. backupServerPublicParams is the chat set (chatZkConfig),
// used for backups only. Before 2026-09-27 the server's generator put the chat set
// in both, and every call-link credential failed to verify. The pre-0.101 calling
// set is for older clients, and the registration CA covers the server's own
// internal gRPC hop, not anything the client speaks to.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = join(import.meta.dirname, '..');
const DEFAULT_SOURCE =
  'D:\\swarm-messenger\\shared\\staging-public-params.json';

const source = process.argv[2] ?? DEFAULT_SOURCE;

// Every config file that carries the endpoint set and the parameters.
const TARGETS = ['swarm-staging.json', 'default.json', 'production.json'];

const FIELDS = [
  'serverPublicParams',
  'genericServerPublicParams',
  'backupServerPublicParams',
];

let params;
try {
  params = JSON.parse(readFileSync(source, 'utf8'));
} catch (error) {
  process.stderr.write(
    `swarm-import-params: cannot read ${source}\n` +
      `${error instanceof Error ? error.message : String(error)}\n\n` +
      'Opus M-B writes this file when the staging server exists. Until then the\n' +
      'config keeps SWARM-PLACEHOLDER-* values and the app refuses to start.\n' +
      'See docs/SWARM-CONFIG.md.\n'
  );
  process.exit(1);
}

const problems = [];

if (
  typeof params.schema === 'string' &&
  !params.schema.startsWith('swarm-messenger/staging-public-params/')
) {
  problems.push(`unexpected schema "${params.schema}"`);
}

for (const field of FIELDS) {
  const value = params[field];
  if (typeof value !== 'string' || value.length === 0) {
    problems.push(`${field} is missing or not a string`);
  } else if (value.startsWith('SWARM-PLACEHOLDER-')) {
    problems.push(`${field} is still a placeholder in the source file`);
  }
}

// serverTrustRoots is a list on purpose, so a rotation can publish the new root
// beside the old one and clients accept both during the overlap.
if (!Array.isArray(params.serverTrustRoots)) {
  problems.push('serverTrustRoots is missing or is not a list');
} else if (params.serverTrustRoots.length === 0) {
  problems.push('serverTrustRoots is an empty list');
} else if (
  params.serverTrustRoots.some(
    root => typeof root !== 'string' || root.startsWith('SWARM-PLACEHOLDER-')
  )
) {
  problems.push('serverTrustRoots contains a non-string or a placeholder');
}

if (problems.length > 0) {
  process.stderr.write(
    `swarm-import-params: ${source} is not usable:\n  ${problems.join('\n  ')}\n`
  );
  process.exit(1);
}

for (const name of TARGETS) {
  const path = join(ROOT, 'config', name);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  for (const field of FIELDS) {
    config[field] = params[field];
  }
  config.serverTrustRoots = [...params.serverTrustRoots];
  delete config._placeholders;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write(`swarm-import-params: updated config/${name}\n`);
}

process.stdout.write(
  '\nswarm-import-params: done. Now run `pnpm run test-node` - the SWARM\n' +
    'endpoint tests check the three config files agree and carry no\n' +
    'placeholders, and the zkgroup test starts verifying serverPublicParams\n' +
    'again as soon as it stops being a placeholder.\n'
);

if (params.endpoints != null) {
  process.stdout.write(
    '\nEndpoints reported by the server (compare with config/, do not assume):\n' +
      `  chat:         ${params.endpoints.chat ?? '(none)'}\n` +
      `  cdn:          ${params.endpoints.cdn ?? '(none)'}\n` +
      `  registration: ${params.endpoints.registration ?? '(none published)'}\n` +
      `  sfu:          ${params.endpoints.sfu ?? '(none)'}\n`
  );
}
