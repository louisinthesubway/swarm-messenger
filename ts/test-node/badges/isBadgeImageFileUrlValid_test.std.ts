// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { isBadgeImageFileUrlValid } from '../../badges/isBadgeImageFileUrlValid.std.ts';

// SWARM change (M1): the same cases, on SWARM hosts.
describe('isBadgeImageFileUrlValid', () => {
  const UPDATES_URL = 'https://static.swarm.green/desktop';

  it('returns false for invalid URLs', () => {
    ['', 'uhh', 'http:'].forEach(url => {
      assert.isFalse(isBadgeImageFileUrlValid(url, UPDATES_URL));
    });
  });

  it("returns false if the URL doesn't start with the right prefix", () => {
    [
      'https://user:pass@static.swarm.green/static/badges/foo',
      'https://swarm.green/static/badges/foo',
      'https://other.swarm.green/static/badges/foo',
      'http://static.swarm.green/static/badges/foo',
      'https://static.swarm.green/badges/foo',
    ].forEach(url => {
      assert.isFalse(
        isBadgeImageFileUrlValid(url, UPDATES_URL),
        `expected ${url} to be rejected`
      );
    });
  });

  it('returns true for valid URLs', () => {
    [
      'https://static.swarm.green/static/badges/foo',
      'https://static.swarm.green/static/badges/foo.svg',
      'https://static.swarm.green/static/badges/foo.txt',
    ].forEach(url => {
      assert.isTrue(
        isBadgeImageFileUrlValid(url, UPDATES_URL),
        `expected ${url} to be accepted`
      );
    });
  });
});
