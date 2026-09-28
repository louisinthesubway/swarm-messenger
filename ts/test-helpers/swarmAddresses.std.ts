// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): addresses for tests, built rather than pasted, so that no
// real person's address is in the tree and every checksum is right by
// construction. Same method as swarm-wallet-core's own tests.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: ReadonlyArray<number>): number {
  const generator = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];
  let chk = 1;
  for (const value of values) {
    // oxlint-disable-next-line no-bitwise
    const top = chk >> 25;
    // oxlint-disable-next-line no-bitwise
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      // oxlint-disable-next-line no-bitwise
      if ((top >> i) & 1) {
        // oxlint-disable-next-line no-bitwise
        chk ^= generator[i] ?? 0;
      }
    }
  }
  // oxlint-disable-next-line no-bitwise
  return chk >>> 0;
}

function expand(hrp: string): Array<number> {
  return [
    // oxlint-disable-next-line no-bitwise
    ...Array.from(hrp, char => char.charCodeAt(0) >> 5),
    0,
    // oxlint-disable-next-line no-bitwise
    ...Array.from(hrp, char => char.charCodeAt(0) & 31),
  ];
}

/** A bech32m string with a valid checksum for `hrp`. `seed` varies the data. */
export function bech32mAddress(hrp: string, seed = 0, length = 60): string {
  const data = Array.from({ length }, (_, i) => (i * 7 + seed) % 32);
  const checksum =
    // oxlint-disable-next-line no-bitwise
    polymod([...expand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONST;
  const check = Array.from(
    { length: 6 },
    // oxlint-disable-next-line no-bitwise
    (_, i) => (checksum >> (5 * (5 - i))) & 31
  );
  return `${hrp}1${[...data, ...check].map(d => CHARSET[d]).join('')}`;
}

/** The same address with its last character changed: a broken checksum. */
export function damaged(address: string): string {
  const last = address.at(-1);
  return `${address.slice(0, -1)}${last === 'q' ? 'p' : 'q'}`;
}
