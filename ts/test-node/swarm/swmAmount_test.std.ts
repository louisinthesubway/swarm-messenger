// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): zatoshi in, SWM on screen, and never a float between.

import { assert } from 'chai';

import {
  MAX_SWM_ZATOSHI,
  formatZatoshiAsSwm,
  parseSwmAmount,
  zatoshiFromString,
} from '../../util/swarm/swmAmount.std.ts';

describe('SWARM wallet: SWM amounts', () => {
  describe('formatZatoshiAsSwm', () => {
    it('always shows eight decimals', () => {
      assert.strictEqual(formatZatoshiAsSwm(0n), '0.00000000');
      assert.strictEqual(formatZatoshiAsSwm(1n), '0.00000001');
      assert.strictEqual(formatZatoshiAsSwm(150_000_000n), '1.50000000');
      assert.strictEqual(formatZatoshiAsSwm(100_000_000n), '1.00000000');
    });

    it('groups whole SWM with thin spaces', () => {
      assert.strictEqual(
        formatZatoshiAsSwm(1_234_567n * 100_000_000n + 89n),
        '1 234 567.00000089'
      );
      assert.strictEqual(
        formatZatoshiAsSwm(MAX_SWM_ZATOSHI),
        '21 000 000.00000000'
      );
    });

    it('is exact where a float is not', () => {
      // 0.1 + 0.2 in SWM: a double would print 0.30000000000000004.
      assert.strictEqual(
        formatZatoshiAsSwm(10_000_000n + 20_000_000n),
        '0.30000000'
      );
      // Above 2^53 zatoshi a double cannot hold every value; bigint can.
      assert.strictEqual(
        formatZatoshiAsSwm(9_007_199_254_740_993n),
        '90 071 992.54740993'
      );
    });

    it('keeps the sign of a negative amount', () => {
      assert.strictEqual(formatZatoshiAsSwm(-5n), '-0.00000005');
    });
  });

  describe('parseSwmAmount', () => {
    const zatoshi = (text: string): bigint => {
      const result = parseSwmAmount(text);
      assert.isTrue(result.ok, `${text} should parse`);
      return result.ok ? result.zatoshi : 0n;
    };
    const problem = (text: string): string => {
      const result = parseSwmAmount(text);
      assert.isFalse(result.ok, `${text} should be refused`);
      return result.ok ? '' : result.problem;
    };

    it('reads what people type, exactly', () => {
      assert.strictEqual(zatoshi('1'), 100_000_000n);
      assert.strictEqual(zatoshi('1.5'), 150_000_000n);
      assert.strictEqual(zatoshi('.5'), 50_000_000n);
      assert.strictEqual(zatoshi('0.00000001'), 1n);
      assert.strictEqual(zatoshi('  2.10  '), 210_000_000n);
      assert.strictEqual(zatoshi('0.1'), 10_000_000n);
      assert.strictEqual(zatoshi('21000000'), MAX_SWM_ZATOSHI);
    });

    it('refuses a ninth decimal instead of dropping it', () => {
      assert.strictEqual(problem('0.000000001'), 'too-many-decimals');
      assert.strictEqual(problem('1.123456789'), 'too-many-decimals');
    });

    it('refuses what is not a plain decimal', () => {
      assert.strictEqual(problem(''), 'empty');
      assert.strictEqual(problem('   '), 'empty');
      assert.strictEqual(problem('abc'), 'not-a-number');
      assert.strictEqual(problem('1e3'), 'not-a-number');
      assert.strictEqual(problem('1,5'), 'not-a-number');
      assert.strictEqual(problem('1 000'), 'not-a-number');
      assert.strictEqual(problem('.'), 'not-a-number');
      assert.strictEqual(problem('0x10'), 'not-a-number');
      assert.strictEqual(problem('+1'), 'not-a-number');
      assert.strictEqual(problem('-1'), 'negative');
    });

    it('refuses nothing and more than exists', () => {
      assert.strictEqual(problem('0'), 'zero');
      assert.strictEqual(problem('0.00000000'), 'zero');
      assert.strictEqual(problem('21000000.00000001'), 'too-large');
      assert.strictEqual(problem('999999999999'), 'too-large');
    });
  });

  describe('zatoshiFromString', () => {
    it('reads the decimal strings that cross IPC', () => {
      assert.strictEqual(zatoshiFromString('0'), 0n);
      assert.strictEqual(
        zatoshiFromString('2100000000000000'),
        MAX_SWM_ZATOSHI
      );
    });

    it('refuses anything else', () => {
      for (const bad of ['', '-1', '01', '1.5', '1e3', ' 1', 'abc']) {
        assert.throws(() => zatoshiFromString(bad), RangeError, undefined, bad);
      }
    });
  });
});
