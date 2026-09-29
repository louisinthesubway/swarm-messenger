// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { assert } from 'chai';
import type { ParsedSignalRoute } from '../../util/signalRoutes.std.ts';
import {
  isSignalRoute,
  linkCallRoute,
  parseSignalRoute,
  toSignalRouteAppUrl,
  toSignalRouteUrl,
  toSignalRouteWebUrl,
} from '../../util/signalRoutes.std.ts';

describe('signalRoutes', () => {
  type CheckConfig = {
    hasAppUrl: boolean;
    hasWebUrl: boolean;
    isRoute: boolean;
  };

  function createCheck(options: Partial<CheckConfig> = {}) {
    const config: CheckConfig = {
      hasAppUrl: true,
      hasWebUrl: true,
      isRoute: true,
      ...options,
    };
    // Different than `isRoute` because of normalization
    const hasRouteUrl = config.hasAppUrl || config.hasWebUrl;
    return function check(input: string, expected: ParsedSignalRoute | null) {
      const url = new URL(input);
      assert.deepEqual(parseSignalRoute(url), expected);
      assert.deepEqual(isSignalRoute(url), config.isRoute);
      assert.deepEqual(toSignalRouteUrl(url) != null, hasRouteUrl);
      assert.deepEqual(toSignalRouteAppUrl(url) != null, config.hasAppUrl);
      assert.deepEqual(toSignalRouteWebUrl(url) != null, config.hasWebUrl);
    };
  }

  const foo = 'FoO.bAr-BaZ_123/456';
  const fooNoSlash = 'FoO.bAr-BaZ_123';

  it('nonsense', () => {
    const check = createCheck({
      isRoute: false,
      hasAppUrl: false,
      hasWebUrl: false,
    });
    // Charles Entertainment Cheese, what are you doing here?
    check('https://www.chuckecheese.com/#p/+1234567890', null);
    // Non-route signal urls
    check('https://signal.me', null);
    check('sgnl://signal.me/#p', null);
    check('sgnl://signal.me/#p/', null);
    check('sgnl://signal.me/p/+1234567890', null);
    check('https://signal.me/?p/+1234567890', null);
  });

  it('normalize', () => {
    const check = createCheck({ isRoute: false, hasAppUrl: true });
    check('http://username:password@signal.me:8888/#p/+1234567890', null);
  });

  it('contactByPhoneNumber', () => {
    const result: ParsedSignalRoute = {
      key: 'contactByPhoneNumber',
      args: { phoneNumber: '+1234567890' },
    };
    const check = createCheck();
    check('https://signal.me/#p/+1234567890', result);
    check('https://signal.me#p/+1234567890', result);
    check('sgnl://signal.me/#p/+1234567890', result);
    check('sgnl://signal.me#p/+1234567890', result);
  });

  it('contactByEncryptedUsername', () => {
    const result: ParsedSignalRoute = {
      key: 'contactByEncryptedUsername',
      args: { encryptedUsername: foo },
    };
    const check = createCheck();
    check(`https://signal.me/#eu/${foo}`, result);
    check(`https://signal.me#eu/${foo}`, result);
    check(`sgnl://signal.me/#eu/${foo}`, result);
    check(`sgnl://signal.me#eu/${foo}`, result);
  });

  it('groupInvites', () => {
    const result: ParsedSignalRoute = {
      key: 'groupInvites',
      args: { inviteCode: fooNoSlash },
    };
    const check = createCheck();
    check(`https://signal.group/#${fooNoSlash}`, result);
    check(`https://signal.group#${fooNoSlash}`, result);
    check(`sgnl://signal.group/#${fooNoSlash}`, result);
    check(`sgnl://signal.group#${fooNoSlash}`, result);
    check(`sgnl://joingroup/#${fooNoSlash}`, result);
    check(`sgnl://joingroup#${fooNoSlash}`, result);
  });

  it('linkDevice without capabilities', () => {
    const result: ParsedSignalRoute = {
      key: 'linkDevice',
      args: { uuid: foo, pubKey: foo, capabilities: [] },
    };
    const check = createCheck({ hasWebUrl: false });
    check(`sgnl://linkdevice/?uuid=${foo}&pub_key=${foo}`, result);
    check(`sgnl://linkdevice?uuid=${foo}&pub_key=${foo}`, result);
  });

  it('linkDevice with one capability', () => {
    const result: ParsedSignalRoute = {
      key: 'linkDevice',
      args: { uuid: foo, pubKey: foo, capabilities: ['backup'] },
    };
    const check = createCheck({ hasWebUrl: false });
    check(
      `sgnl://linkdevice/?uuid=${foo}&pub_key=${foo}&capabilities=backup`,
      result
    );
  });

  it('linkDevice with multiple capabilities', () => {
    const result: ParsedSignalRoute = {
      key: 'linkDevice',
      args: { uuid: foo, pubKey: foo, capabilities: ['a', 'b'] },
    };
    const check = createCheck({ hasWebUrl: false });
    check(
      `sgnl://linkdevice/?uuid=${foo}&pub_key=${foo}&capabilities=a%2Cb`,
      result
    );
  });

  it('captcha', () => {
    const captchaId =
      'signal-hcaptcha.Foo-bAr_baz.challenge.fOo-bAR_baZ.fOO-BaR_baz';
    const result: ParsedSignalRoute = {
      key: 'captcha',
      args: { captchaId },
    };
    const check = createCheck({ hasWebUrl: false });
    check(`signalcaptcha://${captchaId}`, result);
  });

  it('captcha with a trailing slash', () => {
    const captchaId =
      'signal-hcaptcha.Foo-bAr_baz.challenge.fOo-bAR_baZ.fOO-BaR_baz';
    const result: ParsedSignalRoute = {
      key: 'captcha',
      args: { captchaId },
    };
    const check = createCheck({ hasWebUrl: false });
    check(`signalcaptcha://${captchaId}/`, result);
  });

  it('linkCall', () => {
    const result: ParsedSignalRoute = {
      key: 'linkCall',
      args: { key: foo },
    };
    const check = createCheck();
    // SWARM (MSG-P3, 2026-09-29): the two forms SWARM Messenger makes.
    check(`https://swarm.green/call/#key=${foo}`, result);
    check(`https://swarm.green/call#key=${foo}`, result);
    check(`swarm://swarm.green/call/#key=${foo}`, result);
    check(`swarm://swarm.green/call#key=${foo}`, result);
    // The two forms SWARM Messenger 0.1.0 made: still opened.
    check(`https://signal.link/call/#key=${foo}`, result);
    check(`https://signal.link/call#key=${foo}`, result);
    check(`sgnl://signal.link/call/#key=${foo}`, result);
    check(`sgnl://signal.link/call#key=${foo}`, result);
  });

  it('linkCall makes swarm.green links, also from an old signal.link one', () => {
    const key = 'dxbb-xfqz-xkgp-nmrx-bpqn-ptkb-spdt-pdgt';
    const webUrl = `https://swarm.green/call/#key=${key}`;
    const appUrl = `swarm://swarm.green/call/#key=${key}`;
    assert.strictEqual(linkCallRoute.toWebUrl({ key }).toString(), webUrl);
    assert.strictEqual(linkCallRoute.toAppUrl({ key }).toString(), appUrl);
    for (const input of [
      webUrl,
      appUrl,
      `https://signal.link/call/#key=${key}`,
      `sgnl://signal.link/call/#key=${key}`,
    ]) {
      assert.strictEqual(toSignalRouteWebUrl(input)?.toString(), webUrl, input);
      assert.strictEqual(toSignalRouteAppUrl(input)?.toString(), appUrl, input);
    }
  });

  it('linkCall only on its own hosts, schemes and path, with a key', () => {
    const check = createCheck({
      isRoute: false,
      hasAppUrl: false,
      hasWebUrl: false,
    });
    check(`https://example.com/call/#key=${foo}`, null);
    check(`https://swarm.green.example.com/call/#key=${foo}`, null);
    check(`https://www.swarm.green/call/#key=${foo}`, null);
    check(`https://chat.swarm.green/call/#key=${foo}`, null);
    check(`https://signal.link.example.com/call/#key=${foo}`, null);
    check(`sgnl://swarm.green/call/#key=${foo}`, null);
    check(`swarm://signal.link/call/#key=${foo}`, null);
    check(`signalcaptcha://swarm.green/call/#key=${foo}`, null);
    check(`https://swarm.green/#key=${foo}`, null);
    check(`https://swarm.green/calls/#key=${foo}`, null);
    check(`https://swarm.green/call/extra#key=${foo}`, null);
    check('https://swarm.green/call/', null);
    check('https://swarm.green/call/#', null);
    // A fragment without a key is not a call link (the route logs why).
    check('https://swarm.green/call/#other=1', null);
  });

  it('artAddStickers', () => {
    const result: ParsedSignalRoute = {
      key: 'artAddStickers',
      args: { packId: foo, packKey: foo },
    };
    const check = createCheck();
    check(
      `https://signal.art/addstickers/#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    check(
      `https://signal.art/addstickers#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    check(`sgnl://addstickers/?pack_id=${foo}&pack_key=${foo}`, result);
    check(`sgnl://addstickers?pack_id=${foo}&pack_key=${foo}`, result);
  });

  it('showConversation', () => {
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    const args1 = `token=${foo}`;
    const result1: ParsedSignalRoute = {
      key: 'showConversation',
      args: { token: foo },
    };
    check(`sgnl://show-conversation/?${args1}`, result1);
    check(`sgnl://show-conversation?${args1}`, result1);
  });

  it('startCallLobby', () => {
    const result: ParsedSignalRoute = {
      key: 'startCallLobby',
      args: { token: foo },
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check(`sgnl://start-call-lobby/?token=${foo}`, result);
    check(`sgnl://start-call-lobby?token=${foo}`, result);
  });

  it('showWindow', () => {
    const result: ParsedSignalRoute = {
      key: 'showWindow',
      args: {},
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check('sgnl://show-window/', result);
    check('sgnl://show-window', result);
  });

  it('cancelPresenting', () => {
    const result: ParsedSignalRoute = {
      key: 'cancelPresenting',
      args: {},
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check('sgnl://cancel-presenting/', result);
    check('sgnl://cancel-presenting', result);
  });
});
