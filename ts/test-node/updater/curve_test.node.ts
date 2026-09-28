// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { sign, verify } from '../../updater/curve.node.ts';
import { keyPair } from '../../test-helpers/keyPair.node.ts';

describe('updater/curve', () => {
  it('roundtrips', () => {
    const message = Buffer.from('message');
    const { publicKey, privateKey } = keyPair();
    const signature = sign(privateKey, message);
    const verified = verify(publicKey, message, signature);

    assert.strictEqual(verified, true);
  });

  // SWARM change (M1): upstream had a second case here that verified a
  // signature made with Signal's update signing key, read from config. SWARM
  // Messenger ships no update feed and no update signing key, so the key is not
  // in config any more and there is nothing for that case to verify. It is left
  // pending rather than deleted, so nobody has to rediscover why it went. When
  // SWARM has its own update feed, put the SWARM public key in config and fill
  // this in with a SWARM-signed fixture.
  it('verifies with the SWARM update key (no SWARM update feed yet)');
});
