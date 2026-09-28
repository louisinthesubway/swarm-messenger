// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): which SWARM network this app's wallet is on, as
// the renderer knows it, so that a payment notice or an address for the other
// network can be refused the moment it is decrypted (processDataMessage).
//
// A packaged build is always on mainnet. A development build can run on the
// testnet (config `swarmWalletNetwork`, or the pane's developer switch): the
// main process says which in the window's config at start, and every wallet
// state the renderer receives afterwards keeps this value current.

import type { SwarmChainLabel } from '../../types/Payment.std.ts';
import { isSwarmChainLabel } from './swarmChatPayments.std.ts';

let known: SwarmChainLabel | undefined;

export function getSwarmWalletChain(): SwarmChainLabel {
  if (known != null) {
    return known;
  }
  const configured: unknown =
    typeof window === 'undefined'
      ? undefined
      : window.SignalContext?.config?.swarmWalletChain;
  return isSwarmChainLabel(configured) ? configured : 'swarm-mainnet';
}

/** Called with the chain of every wallet state the renderer receives. */
export function noteSwarmWalletChain(chain: string): void {
  if (isSwarmChainLabel(chain)) {
    known = chain;
  }
}

/** Tests only: forget what was noted, back to the configured network. */
export function resetSwarmWalletChainForTests(): void {
  known = undefined;
}
