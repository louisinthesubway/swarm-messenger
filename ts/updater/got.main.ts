// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { StrictOptions as GotOptions } from 'got';
import config from 'config';
import { Agent as HTTPAgent } from 'node:http';

import { packageJson } from '../util/packageJson.main.ts';
import { getUserAgent } from '../util/getUserAgent.node.ts';
import * as durations from '../util/durations/index.std.ts';
import { createHTTPSAgent } from '../util/createHTTPSAgent.node.ts';
import { createProxyAgent } from '../util/createProxyAgent.node.ts';

const GOT_CONNECT_TIMEOUT = durations.MINUTE;
const GOT_LOOKUP_TIMEOUT = durations.MINUTE;
const GOT_SOCKET_TIMEOUT = durations.MINUTE;
const GOT_RETRY_LIMIT = 3;

function getProxyUrl(): string | undefined {
  return process.env.HTTPS_PROXY || process.env.https_proxy;
}

// SWARM change (M1): certificateAuthority is optional now - absent means "use
// the system certificate store", which is what a public TLS certificate needs.
function getCertificateAuthority(): string | undefined {
  return config.has('certificateAuthority')
    ? config.get<string>('certificateAuthority')
    : undefined;
}

export type { GotOptions };

export async function getGotOptions(): Promise<GotOptions> {
  const certificateAuthority = getCertificateAuthority();
  const proxyUrl = getProxyUrl();
  const agent = proxyUrl
    ? {
        http: await createProxyAgent(proxyUrl),
        https: await createProxyAgent(proxyUrl),
      }
    : {
        http: new HTTPAgent(),
        https: createHTTPSAgent(),
      };

  return {
    agent,
    https: {
      certificateAuthority,
    },
    headers: {
      'Cache-Control': 'no-cache',
      'User-Agent': getUserAgent(packageJson.version),
    },
    timeout: {
      connect: GOT_CONNECT_TIMEOUT,
      lookup: GOT_LOOKUP_TIMEOUT,

      // This timeout is reset whenever we get new data on the socket
      socket: GOT_SOCKET_TIMEOUT,
    },
    retry: {
      limit: GOT_RETRY_LIMIT,
      errorCodes: [
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'ENOTFOUND',
        'ENETUNREACH',
        'EAI_AGAIN',
      ],
      methods: ['GET', 'HEAD'],
      statusCodes: [413, 429, 503],
    },
  };
}
