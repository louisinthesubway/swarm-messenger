// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (MSG-P3, 2026-09-29): the call link the app copies and shares
// starts with swarm.green, never with a Signal host, and the app still treats
// it as a call link of its own (no web page is fetched for it).

import { assert } from 'chai';

import { callLinkRootKeyToUrl } from '../../util/callLinkRootKeyToUrl.std.ts';
import {
  linkCallRoute,
  parseSignalRoute,
} from '../../util/signalRoutes.std.ts';
import { isSignalHost } from '../../util/swarm/endpointGuard.std.ts';
import { isCallLink } from '../../types/LinkPreview.std.ts';
import { FAKE_CALL_LINK } from '../../test-helpers/fakeCallLink.std.ts';

describe('SWARM call links', () => {
  const { rootKey } = FAKE_CALL_LINK;

  it('makes a swarm.green link with the key in the fragment', () => {
    assert.strictEqual(
      callLinkRootKeyToUrl(rootKey),
      `https://swarm.green/call/#key=${rootKey}`
    );
  });

  it('makes no link without a key', () => {
    assert.isUndefined(callLinkRootKeyToUrl(''));
  });

  it('makes the same link as linkCallRoute, which the other screens use', () => {
    assert.strictEqual(
      callLinkRootKeyToUrl(rootKey),
      linkCallRoute.toWebUrl({ key: rootKey }).toString()
    );
  });

  it('is a call link the app opens itself, with the same key', () => {
    const url = callLinkRootKeyToUrl(rootKey);
    assert.exists(url);
    assert.isTrue(isCallLink(url));
    assert.deepEqual(parseSignalRoute(url), {
      key: 'linkCall',
      args: { key: rootKey },
    });
  });

  it('never points at a Signal host, in either form', () => {
    const webUrl = callLinkRootKeyToUrl(rootKey);
    assert.exists(webUrl);
    assert.isFalse(isSignalHost(webUrl));
    const appUrl = linkCallRoute.toAppUrl({ key: rootKey }).toString();
    assert.strictEqual(appUrl, `swarm://swarm.green/call/#key=${rootKey}`);
    assert.isFalse(isSignalHost(appUrl));
  });

  it('still opens a link made by 0.1.0, whose host stays on the blocklist', () => {
    const oldUrl = `https://signal.link/call/#key=${rootKey}`;
    assert.isTrue(isCallLink(oldUrl));
    assert.deepEqual(parseSignalRoute(oldUrl), {
      key: 'linkCall',
      args: { key: rootKey },
    });
    assert.isTrue(isSignalHost(oldUrl));
  });
});
