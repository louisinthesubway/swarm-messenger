// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { createSupportUrl } from '../../util/createSupportUrl.std.ts';

// SWARM change (M1): swarm.green/support is one page, not Signal's per-language
// support paths, so the locale travels as a `lang` query parameter instead of
// going into the URL path.
describe('createSupportUrl', () => {
  it('returns support url for "en" locale', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'en' }),
      'https://swarm.green/support?lang=en-us&desktop'
    );
  });

  it('falls back to en-us for a locale we do not have', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'zz' }),
      'https://swarm.green/support?lang=en-us&desktop'
    );
  });

  it('keeps a supported locale', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'fr' }),
      'https://swarm.green/support?lang=fr&desktop'
    );
  });

  it('returns support url with a query', () => {
    assert.strictEqual(
      createSupportUrl({ locale: 'en', query: { debugLog: 'https://' } }),
      'https://swarm.green/support?lang=en-us&desktop&debugLog=https%3A%2F%2F'
    );
  });
});
