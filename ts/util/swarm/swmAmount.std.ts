// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): SWM on the screen, zatoshi everywhere else.
//
// One SWM is 100 000 000 zatoshi. Every amount in the app is a bigint count of
// zatoshi; it becomes a decimal only in these two functions, and never passes
// through a floating-point number on the way. A float cannot hold 0.1 SWM
// exactly, and a wallet that rounds is a wallet that lies about a balance.

export const ZATOSHI_PER_SWM = 100_000_000n;

export const SWM_DECIMALS = 8;

/** The whole supply, 21 million SWM: no amount above it can be meant. */
export const MAX_SWM_ZATOSHI = 21_000_000n * ZATOSHI_PER_SWM;

/** Groups the integer part with thin spaces, as the SWARM style guide does. */
const THIN_SPACE = ' ';

/**
 * Zatoshi as SWM with all eight decimals: 150000000n is "1.50000000".
 *
 * Always eight: a balance column whose decimals come and go is harder to read,
 * and "0.1" next to "0.10000001" hides the difference that matters.
 */
export function formatZatoshiAsSwm(zatoshi: bigint): string {
  const negative = zatoshi < 0n;
  const magnitude = negative ? -zatoshi : zatoshi;
  const whole = (magnitude / ZATOSHI_PER_SWM)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  const fraction = (magnitude % ZATOSHI_PER_SWM)
    .toString()
    .padStart(SWM_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** A zatoshi count that crossed IPC as a decimal string, back to a bigint. */
export function zatoshiFromString(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,18})$/.test(value)) {
    throw new RangeError('zatoshiFromString: not a count of zatoshi');
  }
  return BigInt(value);
}

export type SwmAmountProblemType =
  | 'empty'
  | 'not-a-number'
  | 'negative'
  | 'too-many-decimals'
  | 'zero'
  | 'too-large';

export type SwmAmountParseResultType =
  | Readonly<{ ok: true; zatoshi: bigint }>
  | Readonly<{ ok: false; problem: SwmAmountProblemType }>;

/**
 * What a person typed as an amount of SWM, exactly, as zatoshi.
 *
 * Accepts "1", "1.5", ".5", "0.00000001". Refuses a sign, an exponent, a
 * thousands separator, a comma for a decimal point, and a ninth decimal - an
 * amount field that silently drops a digit has changed what the person asked
 * to send.
 */
export function parseSwmAmount(text: string): SwmAmountParseResultType {
  const value = text.trim();
  if (value === '') {
    return { ok: false, problem: 'empty' };
  }
  if (value.startsWith('-')) {
    return { ok: false, problem: 'negative' };
  }

  const match = /^([0-9]*)(?:\.([0-9]*))?$/.exec(value);
  if (match == null) {
    return { ok: false, problem: 'not-a-number' };
  }
  const wholeText = match[1] ?? '';
  const fractionText = match[2] ?? '';
  if (wholeText === '' && fractionText === '') {
    return { ok: false, problem: 'not-a-number' };
  }
  if (fractionText.length > SWM_DECIMALS) {
    return { ok: false, problem: 'too-many-decimals' };
  }
  // Nine digits of whole SWM is already forty times the supply; stop before
  // BigInt is handed something enormous.
  if (wholeText.replace(/^0+/, '').length > 9) {
    return { ok: false, problem: 'too-large' };
  }

  const zatoshi =
    BigInt(wholeText === '' ? '0' : wholeText) * ZATOSHI_PER_SWM +
    BigInt(fractionText.padEnd(SWM_DECIMALS, '0'));

  if (zatoshi === 0n) {
    return { ok: false, problem: 'zero' };
  }
  if (zatoshi > MAX_SWM_ZATOSHI) {
    return { ok: false, problem: 'too-large' };
  }
  return { ok: true, zatoshi };
}
