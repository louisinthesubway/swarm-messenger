// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): put the SWARM wallet's Rust addon where the app loads it.
//
//   node scripts/swarm-fetch-wallet-addon.mjs                 (this machine)
//   node scripts/swarm-fetch-wallet-addon.mjs --platform linux --arch x64
//
// The addon is about 80 MB per platform, so it is not in git. The pinned list in
// vendor/swarm-wallet-core-native.json names the release it comes from and the
// SHA-256 of every binary; this script downloads the one asked for into
// vendor/swarm-wallet-native/ and keeps it only if the size and the hash are the
// pinned ones. A file already there with the right hash is left alone, so the
// script is cheap to run twice. Nothing is executed and nothing is installed.
//
// Without the addon the app still starts and chats; the Wallet pane says the
// wallet component is missing from this build.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = join(import.meta.dirname, '..');
const MANIFEST = join(ROOT, 'vendor', 'swarm-wallet-core-native.json');
const OUT_DIR = join(ROOT, 'vendor', 'swarm-wallet-native');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function sha256Of(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const platform = argument('platform', process.platform);
  const arch = argument('arch', process.arch);
  const key = `${platform}-${arch}`;
  const entry = manifest.binaries[key];
  if (entry == null) {
    process.stderr.write(
      `swarm-fetch-wallet-addon: ${manifest.release} has no addon for ${key}; ` +
        `it has ${Object.keys(manifest.binaries).join(', ')}. The Wallet pane ` +
        'will say the wallet component is missing.\n'
    );
    process.exit(2);
  }

  const target = join(OUT_DIR, entry.file);
  await mkdir(OUT_DIR, { recursive: true });

  if (existsSync(target)) {
    const [info, digest] = await Promise.all([stat(target), sha256Of(target)]);
    if (info.size === entry.size && digest === entry.sha256) {
      process.stdout.write(
        `swarm-fetch-wallet-addon: ${entry.file} already present, sha256 ${digest}\n`
      );
      return;
    }
    process.stdout.write(
      `swarm-fetch-wallet-addon: ${entry.file} is not the pinned file ` +
        `(sha256 ${digest}); fetching it again\n`
    );
  }

  const url = `${manifest.baseUrl}${entry.file}`;
  process.stdout.write(`swarm-fetch-wallet-addon: downloading ${url}\n`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body == null) {
    throw new Error(`${url} answered HTTP ${response.status}`);
  }

  const temp = `${target}.download`;
  const hash = createHash('sha256');
  let size = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', chunk => {
    hash.update(chunk);
    size += chunk.length;
  });
  await pipeline(body, createWriteStream(temp));
  const digest = hash.digest('hex');

  if (size !== entry.size || digest !== entry.sha256) {
    await rm(temp, { force: true });
    throw new Error(
      `${entry.file} from ${url} is ${size} bytes with sha256 ${digest}; ` +
        `the pinned file is ${entry.size} bytes with sha256 ${entry.sha256}. ` +
        'Refusing it.'
    );
  }

  await rename(temp, target);
  process.stdout.write(
    `swarm-fetch-wallet-addon: ${entry.file} verified, ${size} bytes, sha256 ${digest}\n`
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`swarm-fetch-wallet-addon FAILED: ${error.message}\n`);
  process.exit(1);
}
