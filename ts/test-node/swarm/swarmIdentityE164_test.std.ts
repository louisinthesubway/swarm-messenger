// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B4, 2026-09-29): the shape check the interface uses to never
// show a SWARM account identifier, and the short id in the neutral label. What
// must hold: exactly the identifiers the wallet derivation produces are
// recognised (the vectors are the server contract's, see walletIdentity_test);
// a real phone number, a formatted one and nothing at all are not; the short
// id is the end of an ACI and nothing else; phone-number lookup stays off.

import { assert } from 'chai';

import {
  SWARM_E164_NATIONAL_DIGITS,
  SWARM_E164_PREFIX,
  SWARM_FIND_BY_PHONE_NUMBER,
  isSwarmIdentityE164,
  shortSwarmAccountId,
} from '../../util/swarm/swarmIdentityE164.std.ts';

// The three derivation vectors shared with the server.
const DERIVED = ['+88810866442360', '+88844571413476', '+88834279664637'];

describe('SWARM account identifier: shape', () => {
  it('is +888 and eleven digits', () => {
    assert.strictEqual(SWARM_E164_PREFIX, '+888');
    assert.strictEqual(SWARM_E164_NATIONAL_DIGITS, 11);
  });

  it('recognises the identifiers the wallet derivation produces', () => {
    for (const value of DERIVED) {
      assert.isTrue(isSwarmIdentityE164(value), value);
    }
    assert.isTrue(isSwarmIdentityE164('+88810000000000'), 'smallest');
    assert.isTrue(isSwarmIdentityE164('+88899999999999'), 'largest');
  });

  it('does not take anything else for one', () => {
    for (const value of [
      '+14155550123',
      '+447700900123',
      '+8881086644236',
      '+888108664423600',
      '+88800000000000',
      '+88808664423601',
      '+888 10866442360',
      '+888 108 6644 2360',
      '88810866442360',
      '+88910866442360',
      '+8881086644236a',
      '+88810866442360\n',
      '',
    ]) {
      assert.isFalse(isSwarmIdentityE164(value), JSON.stringify(value));
    }
    assert.isFalse(isSwarmIdentityE164(undefined));
    assert.isFalse(isSwarmIdentityE164(null));
  });
});

describe('SWARM account identifier: the short account id', () => {
  it('is the last four hex characters of the ACI, lower case', () => {
    assert.strictEqual(
      shortSwarmAccountId('8c78cd2a-16ff-427d-83dc-1a5e36ce713d'),
      '713d'
    );
    assert.strictEqual(
      shortSwarmAccountId('8C78CD2A-16FF-427D-83DC-1A5E36CE7B3F'),
      '7b3f'
    );
  });

  it('is nothing for what is not an ACI', () => {
    assert.isUndefined(
      shortSwarmAccountId('PNI:8c78cd2a-16ff-427d-83dc-1a5e36ce713d')
    );
    assert.isUndefined(shortSwarmAccountId('+88810866442360'));
    assert.isUndefined(shortSwarmAccountId(''));
    assert.isUndefined(shortSwarmAccountId(undefined));
    assert.isUndefined(shortSwarmAccountId(null));
  });
});

describe('SWARM: finding people by phone number', () => {
  it('is off', () => {
    assert.isFalse(SWARM_FIND_BY_PHONE_NUMBER);
  });
});
