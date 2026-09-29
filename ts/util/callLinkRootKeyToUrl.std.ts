// Copyright 2024 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

// SWARM change (MSG-P3, 2026-09-29): call links are made on swarm.green, not on
// Signal's signal.link, so a link shared outside the app never points people at
// Signal's name. Keep in step with linkCallRoute.toWebUrl in signalRoutes.std.ts.
// The root key travels only in the fragment (#key=...), which a browser never
// sends to any server.
export function callLinkRootKeyToUrl(rootKey: string): string | undefined {
  if (!rootKey) {
    return;
  }

  return `https://swarm.green/call/#key=${rootKey}`;
}
