// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
import { resolve4 as resolve4Cb, resolve6 as resolve6Cb } from 'node:dns';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const resolve4 = promisify(resolve4Cb);
const resolve6 = promisify(resolve6Cb);

const FALLBACK_DOMAINS = [
  'chat.swarm.green',
  'storage.chat.swarm.green',
  'cdn.chat.swarm.green',
  'sfu.chat.swarm.green',
  'static.swarm.green',
];

const config = await Promise.all(
  FALLBACK_DOMAINS.sort().map(async domain => {
    const ipv4endpoints = (await resolve4(domain)).map(a => ({
      family: 'ipv4',
      address: a,
    }));

    const ipv6endpoints = (await resolve6(domain)).map(a => ({
      family: 'ipv6',
      address: a,
    }));

    const endpoints = [...ipv4endpoints, ...ipv6endpoints]
      .filter(value => {
        return value != null;
      })
      .sort((a, b) => {
        if (a.family < b.family) {
          return -1;
        }
        if (a.family > b.family) {
          return 1;
        }

        if (a.address < b.address) {
          return -1;
        }
        if (a.address > b.address) {
          return 1;
        }
        return 0;
      });

    return { domain, endpoints };
  })
);

const outPath = join(import.meta.dirname, '..', 'build', 'dns-fallback.json');

await writeFile(outPath, `${JSON.stringify(config, null, 2)}\n`);
