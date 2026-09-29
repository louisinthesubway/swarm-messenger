// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
import { assert } from 'chai';
import type { ParsedSignalRoute } from '../../util/signalRoutes.std.ts';
import {
  artAddStickersRoute,
  contactByEncryptedUsernameRoute,
  groupInvitesRoute,
  isSignalRoute,
  linkCallRoute,
  linkDeviceRoute,
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
    // SWARM (B3, 2026-09-29): nor on swarm.green outside the link paths.
    check('https://swarm.green/u/', null);
    check('https://swarm.green/#p/+1234567890', null);
    check(`https://swarm.green/#eu/${foo}`, null);
    check(`https://swarm.green/#${fooNoSlash}`, null);
    check(`https://www.swarm.green/u/#eu/${foo}`, null);
    check(`https://chat.swarm.green/g/#${fooNoSlash}`, null);
    check(`sgnl://swarm.green/u/#eu/${foo}`, null);
    check(`swarm://signal.me/#eu/${foo}`, null);
    check(`swarm://signal.group/#${fooNoSlash}`, null);
    check(
      `https://swarm.green/addstickers/#pack_id=${foo}&pack_key=${foo}`,
      null
    );
    check(`swarm://addstickers?pack_id=${foo}&pack_key=${foo}`, null);
    check(`swarm://joingroup/#${fooNoSlash}`, null);
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
    // SWARM (B3, 2026-09-29): the forms the app would make.
    check('https://swarm.green/u/#p/+1234567890', result);
    check('https://swarm.green/u#p/+1234567890', result);
    check('swarm://swarm.green/u/#p/+1234567890', result);
    check('swarm://swarm.green/u#p/+1234567890', result);
    // Signal's forms: still opened.
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
    // SWARM (B3, 2026-09-29): the forms the app makes.
    check(`https://swarm.green/u/#eu/${foo}`, result);
    check(`https://swarm.green/u#eu/${foo}`, result);
    check(`swarm://swarm.green/u/#eu/${foo}`, result);
    check(`swarm://swarm.green/u#eu/${foo}`, result);
    // Signal's forms, made before B3: still opened.
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
    // SWARM (B3, 2026-09-29): the forms the app makes.
    check(`https://swarm.green/g/#${fooNoSlash}`, result);
    check(`https://swarm.green/g#${fooNoSlash}`, result);
    check(`swarm://swarm.green/g/#${fooNoSlash}`, result);
    check(`swarm://swarm.green/g#${fooNoSlash}`, result);
    // Signal's forms, made before B3: still opened.
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
    // SWARM (B3, 2026-09-29): the form the app makes.
    check(`swarm://linkdevice/?uuid=${foo}&pub_key=${foo}`, result);
    check(`swarm://linkdevice?uuid=${foo}&pub_key=${foo}`, result);
    // Signal's form: still read.
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
    // SWARM (B3, 2026-09-29): the forms the app makes.
    check(
      `https://swarm.green/stickers/#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    check(
      `https://swarm.green/stickers#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    check(
      `swarm://swarm.green/stickers/#pack_id=${foo}&pack_key=${foo}`,
      result
    );
    // Signal's forms, made before B3: still opened.
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
    check(`swarm://show-conversation/?${args1}`, result1);
    check(`swarm://show-conversation?${args1}`, result1);
    check(`sgnl://show-conversation/?${args1}`, result1);
    check(`sgnl://show-conversation?${args1}`, result1);
  });

  it('startCallLobby', () => {
    const result: ParsedSignalRoute = {
      key: 'startCallLobby',
      args: { token: foo },
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check(`swarm://start-call-lobby/?token=${foo}`, result);
    check(`swarm://start-call-lobby?token=${foo}`, result);
    check(`sgnl://start-call-lobby/?token=${foo}`, result);
    check(`sgnl://start-call-lobby?token=${foo}`, result);
  });

  it('showWindow', () => {
    const result: ParsedSignalRoute = {
      key: 'showWindow',
      args: {},
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check('swarm://show-window/', result);
    check('swarm://show-window', result);
    check('sgnl://show-window/', result);
    check('sgnl://show-window', result);
  });

  it('cancelPresenting', () => {
    const result: ParsedSignalRoute = {
      key: 'cancelPresenting',
      args: {},
    };
    const check = createCheck({ isRoute: true, hasWebUrl: false });
    check('swarm://cancel-presenting/', result);
    check('swarm://cancel-presenting', result);
    check('sgnl://cancel-presenting/', result);
    check('sgnl://cancel-presenting', result);
  });

  // SWARM (B3, 2026-09-29): every link the app makes is on swarm.green or in
  // the swarm: scheme, also when it re-makes a link that came in a Signal form.
  it('makes swarm.green username links, also from an old signal.me one', () => {
    const encryptedUsername = foo;
    const webUrl = `https://swarm.green/u/#eu/${foo}`;
    const appUrl = `swarm://swarm.green/u/#eu/${foo}`;
    assert.strictEqual(
      contactByEncryptedUsernameRoute
        .toWebUrl({ encryptedUsername })
        .toString(),
      webUrl
    );
    assert.strictEqual(
      contactByEncryptedUsernameRoute
        .toAppUrl({ encryptedUsername })
        .toString(),
      appUrl
    );
    for (const input of [
      webUrl,
      appUrl,
      `https://signal.me/#eu/${foo}`,
      `sgnl://signal.me/#eu/${foo}`,
    ]) {
      assert.strictEqual(toSignalRouteWebUrl(input)?.toString(), webUrl, input);
      assert.strictEqual(toSignalRouteAppUrl(input)?.toString(), appUrl, input);
    }
  });

  it('makes swarm.green phone-number links, also from an old signal.me one', () => {
    const webUrl = 'https://swarm.green/u/#p/+1234567890';
    const appUrl = 'swarm://swarm.green/u/#p/+1234567890';
    for (const input of [
      webUrl,
      appUrl,
      'https://signal.me/#p/+1234567890',
      'sgnl://signal.me/#p/+1234567890',
    ]) {
      assert.strictEqual(toSignalRouteWebUrl(input)?.toString(), webUrl, input);
      assert.strictEqual(toSignalRouteAppUrl(input)?.toString(), appUrl, input);
    }
  });

  it('makes swarm.green group links, also from an old signal.group one', () => {
    const inviteCode = fooNoSlash;
    const webUrl = `https://swarm.green/g/#${inviteCode}`;
    const appUrl = `swarm://swarm.green/g/#${inviteCode}`;
    assert.strictEqual(
      groupInvitesRoute.toWebUrl({ inviteCode }).toString(),
      webUrl
    );
    assert.strictEqual(
      groupInvitesRoute.toAppUrl({ inviteCode }).toString(),
      appUrl
    );
    for (const input of [
      webUrl,
      appUrl,
      `https://signal.group/#${inviteCode}`,
      `sgnl://signal.group/#${inviteCode}`,
      `sgnl://joingroup/#${inviteCode}`,
    ]) {
      assert.strictEqual(toSignalRouteWebUrl(input)?.toString(), webUrl, input);
      assert.strictEqual(toSignalRouteAppUrl(input)?.toString(), appUrl, input);
    }
  });

  it('makes swarm.green sticker pack links, also from an old signal.art one', () => {
    const packId = 'c8c83285b547872ac4c589d64a6edd6a';
    const packKey =
      '59bb3a8860f0e6a5a83a5337a015c8d55ecd2193f82d77202f3b8112a845636e';
    const params = `pack_id=${packId}&pack_key=${packKey}`;
    const webUrl = `https://swarm.green/stickers/#${params}`;
    const appUrl = `swarm://swarm.green/stickers/#${params}`;
    assert.strictEqual(
      artAddStickersRoute.toWebUrl({ packId, packKey }).toString(),
      webUrl
    );
    assert.strictEqual(
      artAddStickersRoute.toAppUrl({ packId, packKey }).toString(),
      appUrl
    );
    for (const input of [
      webUrl,
      appUrl,
      `https://signal.art/addstickers/#${params}`,
      `sgnl://addstickers/?${params}`,
    ]) {
      assert.strictEqual(toSignalRouteWebUrl(input)?.toString(), webUrl, input);
      assert.strictEqual(toSignalRouteAppUrl(input)?.toString(), appUrl, input);
    }
  });

  it('makes a swarm://linkdevice link, also from an old sgnl one', () => {
    const args = { uuid: 'abc', pubKey: 'BQ+/=', capabilities: ['nopni'] };
    const appUrl =
      'swarm://linkdevice?uuid=abc&pub_key=BQ%2B%2F%3D&capabilities=nopni';
    assert.strictEqual(linkDeviceRoute.toAppUrl(args).toString(), appUrl);
    assert.deepEqual(parseSignalRoute(appUrl), { key: 'linkDevice', args });
    assert.deepEqual(parseSignalRoute(appUrl.replace('swarm:', 'sgnl:')), {
      key: 'linkDevice',
      args,
    });
  });
});
