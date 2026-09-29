// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): the worker thread that holds the SWARM wallet.
// See swarmWalletProtocol.std.ts for why it is a worker, and
// swarmWalletHandler.node.ts for what it does.
//
// Nothing here writes to a log: the main process logs outcomes, by category,
// from the replies. A reply carries the recovery phrase only for the
// 'seed-phrase' request (B6), as bytes that are transferred, not copied.

import { parentPort, workerData } from 'node:worker_threads';

import type { NativeAddon } from 'swarm-wallet-core';

import { drop } from '../util/drop.std.ts';

import {
  SwarmWalletHandler,
  toWorkerError,
} from './swarmWalletHandler.node.ts';
import type {
  WorkerDataType,
  WorkerMessageType,
  WorkerReplyType,
} from './swarmWalletProtocol.std.ts';

if (!parentPort) {
  throw new Error('Must run as a worker thread');
}

const port = parentPort;
const { addonPath } = workerData as WorkerDataType;

let addon: NativeAddon | undefined;

/**
 * Loads the addon on first use. `process.dlopen` rather than `require`, so
 * the path is taken exactly as given - the main process has already resolved
 * it, inside `app.asar.unpacked` in a packaged build.
 */
function loadAddon(): NativeAddon {
  if (addon != null) {
    return addon;
  }
  const loaded = { exports: {} as Record<string, unknown> };
  process.dlopen(loaded, addonPath);
  if (typeof loaded.exports.init_from_seed !== 'function') {
    // A wrong-architecture build loads and then fails on every call; say so
    // here instead.
    throw new Error('the wallet addon loaded but is not the SWARM wallet');
  }
  addon = loaded.exports as unknown as NativeAddon;
  return addon;
}

const handler = new SwarmWalletHandler({ loadAddon });

// One request at a time: the addon keeps one wallet and one proposal, and two
// interleaved calls against it are how a quote ends up confirming the wrong
// payment. Requests are answered in arrival order.
const waiting: Array<WorkerMessageType> = [];
let draining = false;

async function drain(): Promise<void> {
  if (draining) {
    return;
  }
  draining = true;
  try {
    for (
      let message = waiting.shift();
      message != null;
      message = waiting.shift()
    ) {
      let reply: WorkerReplyType;
      try {
        reply = {
          id: message.id,
          ok: true,
          // One at a time is the point of this loop.
          // oxlint-disable-next-line no-await-in-loop
          value: await handler.handle(message.request),
        };
      } catch (error) {
        reply = { id: message.id, ok: false, error: toWorkerError(error) };
      }
      // SWARM change (B6, 2026-09-29): a reply that is a byte buffer (the
      // recovery phrase) is transferred, not copied, so this thread keeps
      // none of it.
      if (reply.ok && reply.value instanceof Uint8Array) {
        // The handler makes the buffer with TextEncoder: an ArrayBuffer, never
        // a SharedArrayBuffer.
        port.postMessage(reply, [reply.value.buffer as ArrayBuffer]);
      } else {
        port.postMessage(reply);
      }
    }
  } finally {
    draining = false;
  }
}

port.on('message', (message: WorkerMessageType) => {
  waiting.push(message);
  drop(drain());
});
