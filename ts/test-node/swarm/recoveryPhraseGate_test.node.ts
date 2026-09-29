// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the rules the main process holds before the
// recovery phrase goes to the reveal window, and what it keeps afterwards.
// What must hold: one window, once, only after the typed word and the wait
// (or the OS confirmation); the main process's copy of the words is zeroed as
// it is sent; copy and save act only on the exact words that window was shown;
// the clipboard is cleared a minute later only if it still holds them.

import { assert } from 'chai';

import { generateRecoveryPhrase } from '../../util/swarm/bip39.node.ts';
import {
  RecoveryPhraseGate,
  deliverRecoveryPhraseOnce,
} from '../../util/swarm/recoveryPhraseGate.node.ts';
import { RecoveryPhraseClipboard } from '../../util/swarm/recoveryPhraseClipboard.node.ts';
import {
  RECOVERY_PHRASE_CLIPBOARD_CLEAR_MS,
  RECOVERY_PHRASE_CONFIRM_DELAY_MS,
  RECOVERY_PHRASE_REVEAL_WORD,
} from '../../types/SwarmRecoveryPhrase.std.ts';

const WINDOW = 42;
const OTHER_WINDOW = 7;

function bytesOf(phrase: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(phrase);
}

describe('SWARM recovery phrase: the reveal gate (B6)', () => {
  let now: number;
  let gate: RecoveryPhraseGate;

  beforeEach(() => {
    now = 1_000_000;
    gate = new RecoveryPhraseGate({ now: () => now });
  });

  it('answers nobody before a window is armed', () => {
    assert.isFalse(gate.isArmedFor(WINDOW));
    assert.isUndefined(gate.status(WINDOW));
    assert.deepEqual(gate.authorize(WINDOW, RECOVERY_PHRASE_REVEAL_WORD), {
      ok: false,
      refusal: 'used',
    });
  });

  describe('typed confirmation (Linux, no Touch ID, no Windows Hello)', () => {
    beforeEach(() => {
      gate.arm({ senderId: WINDOW, confirmation: 'typed' });
    });

    it('tells the window to wait three seconds', () => {
      assert.deepEqual(gate.status(WINDOW), {
        confirmation: 'typed',
        waitMs: RECOVERY_PHRASE_CONFIRM_DELAY_MS,
      });
      now += 1_000;
      assert.strictEqual(gate.status(WINDOW)?.waitMs, 2_000);
      now += 5_000;
      assert.strictEqual(gate.status(WINDOW)?.waitMs, 0);
    });

    it('refuses any other window', () => {
      now += RECOVERY_PHRASE_CONFIRM_DELAY_MS;
      assert.isUndefined(gate.status(OTHER_WINDOW));
      assert.isFalse(gate.isArmedFor(OTHER_WINDOW));
      assert.deepEqual(gate.authorize(OTHER_WINDOW, 'reveal'), {
        ok: false,
        refusal: 'used',
      });
      // ...and that did not use up the real window's one chance.
      assert.deepEqual(gate.authorize(WINDOW, 'reveal'), { ok: true });
    });

    it('refuses the right word before the wait is over', () => {
      now += RECOVERY_PHRASE_CONFIRM_DELAY_MS - 1;
      assert.deepEqual(gate.authorize(WINDOW, 'reveal'), {
        ok: false,
        refusal: 'not-confirmed',
      });
    });

    it('refuses the wrong word, and lets the person try again', () => {
      now += RECOVERY_PHRASE_CONFIRM_DELAY_MS;
      for (const wrong of ['', 'revea', 'show', 'reveal it']) {
        assert.deepEqual(gate.authorize(WINDOW, wrong), {
          ok: false,
          refusal: 'not-confirmed',
        });
      }
      assert.deepEqual(gate.authorize(WINDOW, '  Reveal '), { ok: true });
    });

    it('says yes once only', () => {
      now += RECOVERY_PHRASE_CONFIRM_DELAY_MS;
      assert.deepEqual(gate.authorize(WINDOW, 'reveal'), { ok: true });
      assert.deepEqual(gate.authorize(WINDOW, 'reveal'), {
        ok: false,
        refusal: 'used',
      });
    });

    it('answers nothing once the window is gone', () => {
      now += RECOVERY_PHRASE_CONFIRM_DELAY_MS;
      gate.disarm();
      assert.isFalse(gate.isArmedFor(WINDOW));
      assert.deepEqual(gate.authorize(WINDOW, 'reveal'), {
        ok: false,
        refusal: 'used',
      });
    });
  });

  describe('OS confirmation (Touch ID, Windows Hello)', () => {
    it('needs no word and no wait, and is still once only', () => {
      gate.arm({ senderId: WINDOW, confirmation: 'os' });
      assert.deepEqual(gate.status(WINDOW), { confirmation: 'os', waitMs: 0 });
      assert.deepEqual(gate.authorize(WINDOW, ''), { ok: true });
      assert.deepEqual(gate.authorize(WINDOW, ''), {
        ok: false,
        refusal: 'used',
      });
    });
  });

  describe('after the words are shown', () => {
    const phrase = generateRecoveryPhrase();

    beforeEach(() => {
      gate.arm({ senderId: WINDOW, confirmation: 'os' });
      gate.authorize(WINDOW, '');
    });

    it('zeroes the main process copy as it is sent, and sends the words', () => {
      const bytes = bytesOf(phrase);
      gate.shown(WINDOW, bytes);
      let sent: string | undefined;
      deliverRecoveryPhraseOnce(bytes, payload => {
        // What Electron's send does: a copy, made before it returns.
        sent = new TextDecoder().decode(payload.slice());
      });
      assert.strictEqual(sent, phrase);
      assert.isTrue(bytes.every(byte => byte === 0));
    });

    it('zeroes the copy even when sending throws', () => {
      const bytes = bytesOf(phrase);
      assert.throws(() =>
        deliverRecoveryPhraseOnce(bytes, () => {
          throw new Error('the window is gone');
        })
      );
      assert.isTrue(bytes.every(byte => byte === 0));
    });

    it('recognises exactly those words, from that window only', () => {
      gate.shown(WINDOW, bytesOf(phrase));
      assert.isTrue(gate.holdsPhrase(WINDOW, phrase));
      assert.isFalse(gate.holdsPhrase(OTHER_WINDOW, phrase));
      assert.isFalse(gate.holdsPhrase(WINDOW, `${phrase} `));
      assert.isFalse(gate.holdsPhrase(WINDOW, generateRecoveryPhrase()));
      assert.isFalse(gate.holdsPhrase(WINDOW, 'anything else'));
      gate.disarm();
      assert.isFalse(gate.holdsPhrase(WINDOW, phrase));
    });

    it('recognises nothing before the words are shown', () => {
      assert.isFalse(gate.holdsPhrase(WINDOW, phrase));
    });
  });
});

describe('SWARM recovery phrase: the clipboard (B6)', () => {
  const phrase = generateRecoveryPhrase();

  function setup() {
    let text = 'what was there before';
    let cleared = 0;
    const scheduled: Array<{ work: () => void; ms: number; live: boolean }> =
      [];
    const guard = new RecoveryPhraseClipboard({
      clipboard: {
        readText: async () => text,
        writeText: async value => {
          text = value;
        },
        clear: () => {
          text = '';
          cleared += 1;
        },
      },
      schedule: (work, ms) => {
        const entry = { work, ms, live: true };
        scheduled.push(entry);
        return () => {
          entry.live = false;
        };
      },
    });
    return {
      guard,
      scheduled,
      read: () => text,
      set: (value: string) => {
        text = value;
      },
      cleared: () => cleared,
    };
  }

  it('copies, and clears after a minute if the words are still there', async () => {
    const { guard, scheduled, read, cleared } = setup();
    assert.strictEqual(
      await guard.copy(phrase),
      RECOVERY_PHRASE_CLIPBOARD_CLEAR_MS
    );
    assert.strictEqual(read(), phrase);
    assert.lengthOf(scheduled, 1);
    assert.strictEqual(scheduled[0]?.ms, 60_000);
    assert.isTrue(await guard.clearIfStillHeld());
    assert.strictEqual(read(), '');
    assert.strictEqual(cleared(), 1);
    assert.isFalse(scheduled[0]?.live);
  });

  it('leaves the clipboard alone when the person copied something else since', async () => {
    const { guard, read, set, cleared } = setup();
    await guard.copy(phrase);
    set('a shopping list');
    assert.isFalse(await guard.clearIfStillHeld());
    assert.strictEqual(read(), 'a shopping list');
    assert.strictEqual(cleared(), 0);
  });

  it('clears at quit, without reading, while the words may still be there', async () => {
    const { guard, scheduled, read } = setup();
    assert.isFalse(guard.clearAtQuit());
    await guard.copy(phrase);
    assert.isTrue(guard.clearAtQuit());
    assert.strictEqual(read(), '');
    assert.isFalse(scheduled[0]?.live);
    assert.isFalse(guard.clearAtQuit());
    assert.isFalse(await guard.clearIfStillHeld());
  });
});
