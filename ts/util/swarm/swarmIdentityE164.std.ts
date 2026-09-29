// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B4, 2026-09-29): the shape of the synthetic account
// identifier, and what the interface shows instead of it.
//
// A SWARM account signs in with its wallet and has no telephone number. It
// still carries an E.164-shaped identifier, derived from its identity key
// (`walletIdentity.node.ts`), because the server, storage service and contact
// discovery key accounts by one. That identifier is data, never a phone number,
// and is never shown: this file is what the display code asks.
//
// Pure, synchronous, no Electron: imported by the Node-only derivation, by the
// display helpers in the renderer and by the tests alike.

/** ITU-T calling code 888: non-geographic, non-dialable. See the server's SwarmWalletIdentity. */
export const SWARM_E164_PREFIX = '+888';

/** How many digits follow the prefix. */
export const SWARM_E164_NATIONAL_DIGITS = 11;

// `+888`, then 11 digits with no leading zero: the derivation adds 10^10 to a
// value below 9 * 10^10, so the national part is always 10^10 .. 10^11 - 1.
const SWARM_E164_PATTERN = new RegExp(
  `^\\${SWARM_E164_PREFIX}[1-9]\\d{${SWARM_E164_NATIONAL_DIGITS - 1}}$`
);

/**
 * True for an identifier of exactly the shape `accountIdentifierFor` derives
 * from a wallet identity. Anything else - a real number, a formatted number,
 * nothing at all - is false.
 */
export function isSwarmIdentityE164(e164: string | null | undefined): boolean {
  return typeof e164 === 'string' && SWARM_E164_PATTERN.test(e164);
}

/** How many hex characters of the account id a neutral label carries. */
export const SWARM_SHORT_ACCOUNT_ID_LENGTH = 4;

/**
 * The short account id in the neutral fallback label ("SWARM account 1a2b"):
 * the last four hex characters of the account's ACI (a UUID), lower case. The
 * ACI is what the person's safety number and username link are built on,
 * never a phone number, and four characters tell two unnamed contacts apart in
 * a list without pretending to be an address.
 *
 * Undefined when there is no ACI-shaped id to shorten.
 */
export function shortSwarmAccountId(
  aci: string | null | undefined
): string | undefined {
  if (typeof aci !== 'string') {
    return undefined;
  }
  const hex = aci.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    return undefined;
  }
  return hex.slice(-SWARM_SHORT_ACCOUNT_ID_LENGTH);
}

/**
 * Whether the interface offers to find or add people by phone number: typing
 * digits into "New chat" or into a group member search. Off: SWARM accounts
 * sign in with a wallet and are found by username. Upstream's code stays behind
 * this switch to keep merges small.
 */
export const SWARM_FIND_BY_PHONE_NUMBER = false;
