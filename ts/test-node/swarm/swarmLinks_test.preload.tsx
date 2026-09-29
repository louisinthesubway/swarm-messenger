// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B3, 2026-09-29): links and QR codes. What must hold:
// - every link the app makes (username, group, sticker pack, call, and the
//   app-only links a notification opens) is on swarm.green or in the swarm:
//   scheme, never on a Signal host and never sgnl:;
// - every Signal form made before is still read, as the same link, and the new
//   https://swarm.green forms count as links of the app's own (link previews,
//   in-app opening), also when typed without https://;
// - the mark in the middle of every QR code is the SWARM mark, path for path
//   as in images/swarm-mark.svg, and none of Signal's speech bubble;
// - the username card defaults to SWARM orange without a new colour id in the
//   synced account record.

import { assert } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  artAddStickersRoute,
  cancelPresentingRoute,
  contactByEncryptedUsernameRoute,
  groupInvitesRoute,
  linkCallRoute,
  linkDeviceRoute,
  parseSignalRoute,
  showConversationRoute,
  showWindowRoute,
  startCallLobbyRoute,
  toSignalRouteAppUrl,
  toSignalRouteWebUrl,
} from '../../util/signalRoutes.std.ts';
import { isSignalHost } from '../../util/swarm/endpointGuard.std.ts';
import {
  isCallLink,
  isGroupLink,
  isStickerPack,
} from '../../types/LinkPreview.std.ts';
import {
  BrandedQRCode,
  SWARM_MARK_PATHS,
  SWARM_MARK_VIEWBOX_HEIGHT,
  SWARM_MARK_VIEWBOX_WIDTH,
} from '../../components/BrandedQRCode.dom.tsx';
import {
  COLOR_MAP,
  DEFAULT_COLOR_ID,
  DEFAULT_PRESET,
} from '../../components/UsernameLinkEditor.dom.tsx';
import { linkify } from '../../components/conversation/Linkify.dom.tsx';
import { SignalService as Proto } from '../../protobuf/index.std.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

const ENCRYPTED_USERNAME =
  'n-AJkmmykrFB7j6UODGndSycxcMdp_v6ppRp9rFu5Ad39q_9Ngi_k9-TARWfT43t';
const INVITE_CODE = 'CjQKIBy3Ffb1vHXBL0mUMS1jB9HQCBTj9Uq1GQx1Qb4ZkLbnEhDl';
const PACK_ID = 'c8c83285b547872ac4c589d64a6edd6a';
const PACK_KEY =
  '59bb3a8860f0e6a5a83a5337a015c8d55ecd2193f82d77202f3b8112a845636e';
const STICKER_PARAMS = `pack_id=${PACK_ID}&pack_key=${PACK_KEY}`;
const CALL_KEY = 'dxbb-xfqz-xkgp-nmrx-bpqn-ptkb-spdt-pdgt';

function assertSwarmWebUrl(url: URL, what: string): void {
  assert.strictEqual(url.protocol, 'https:', what);
  assert.strictEqual(url.hostname, 'swarm.green', what);
  assert.isFalse(isSignalHost(url.toString()), what);
}

function assertSwarmAppUrl(url: URL, what: string): void {
  assert.strictEqual(url.protocol, 'swarm:', what);
  assert.isFalse(isSignalHost(url.toString()), what);
}

describe('SWARM links and QR codes', () => {
  describe('links the app makes', () => {
    it('are on swarm.green, with the secret in the fragment', () => {
      const made: ReadonlyArray<[string, URL, URL]> = [
        [
          'username',
          contactByEncryptedUsernameRoute.toWebUrl({
            encryptedUsername: ENCRYPTED_USERNAME,
          }),
          contactByEncryptedUsernameRoute.toAppUrl({
            encryptedUsername: ENCRYPTED_USERNAME,
          }),
        ],
        [
          'group',
          groupInvitesRoute.toWebUrl({ inviteCode: INVITE_CODE }),
          groupInvitesRoute.toAppUrl({ inviteCode: INVITE_CODE }),
        ],
        [
          'sticker pack',
          artAddStickersRoute.toWebUrl({ packId: PACK_ID, packKey: PACK_KEY }),
          artAddStickersRoute.toAppUrl({ packId: PACK_ID, packKey: PACK_KEY }),
        ],
        [
          'call',
          linkCallRoute.toWebUrl({ key: CALL_KEY }),
          linkCallRoute.toAppUrl({ key: CALL_KEY }),
        ],
      ];
      for (const [what, webUrl, appUrl] of made) {
        assertSwarmWebUrl(webUrl, what);
        assertSwarmAppUrl(appUrl, what);
        assert.strictEqual(appUrl.hostname, 'swarm.green', what);
        assert.strictEqual(appUrl.pathname, webUrl.pathname, what);
        assert.strictEqual(appUrl.hash, webUrl.hash, what);
        // Browsers never send the fragment to the server.
        assert.strictEqual(webUrl.search, '', what);
      }
      assert.strictEqual(
        made.map(([, webUrl]) => webUrl.toString()).join('\n'),
        [
          `https://swarm.green/u/#eu/${ENCRYPTED_USERNAME}`,
          `https://swarm.green/g/#${INVITE_CODE}`,
          `https://swarm.green/stickers/#${STICKER_PARAMS}`,
          `https://swarm.green/call/#key=${CALL_KEY}`,
        ].join('\n')
      );
    });

    it('turns an old phone-number link into a swarm.green one', () => {
      const oldUrl = 'https://signal.me/#p/+15551234567';
      assert.strictEqual(
        toSignalRouteWebUrl(oldUrl)?.toString(),
        'https://swarm.green/u/#p/+15551234567'
      );
      assert.strictEqual(
        toSignalRouteAppUrl(oldUrl)?.toString(),
        'swarm://swarm.green/u/#p/+15551234567'
      );
    });

    it('makes the linking QR code and the notification links swarm:', () => {
      const made: ReadonlyArray<[string, URL]> = [
        [
          'link device',
          linkDeviceRoute.toAppUrl({
            uuid: 'abc',
            pubKey: 'BQ',
            capabilities: ['nopni'],
          }),
        ],
        ['show conversation', showConversationRoute.toAppUrl({ token: 't' })],
        ['start call lobby', startCallLobbyRoute.toAppUrl({ token: 't' })],
        ['show window', showWindowRoute.toAppUrl({})],
        ['cancel presenting', cancelPresentingRoute.toAppUrl({})],
      ];
      for (const [what, url] of made) {
        assertSwarmAppUrl(url, what);
        assert.isNotNull(parseSignalRoute(url), what);
      }
    });
  });

  describe('links shared before', () => {
    const cases: ReadonlyArray<[string, ReadonlyArray<string>]> = [
      [
        `https://swarm.green/u/#eu/${ENCRYPTED_USERNAME}`,
        [
          `https://signal.me/#eu/${ENCRYPTED_USERNAME}`,
          `sgnl://signal.me/#eu/${ENCRYPTED_USERNAME}`,
        ],
      ],
      [
        `https://swarm.green/g/#${INVITE_CODE}`,
        [
          `https://signal.group/#${INVITE_CODE}`,
          `sgnl://signal.group/#${INVITE_CODE}`,
          `sgnl://joingroup/#${INVITE_CODE}`,
        ],
      ],
      [
        `https://swarm.green/stickers/#${STICKER_PARAMS}`,
        [
          `https://signal.art/addstickers/#${STICKER_PARAMS}`,
          `sgnl://addstickers/?${STICKER_PARAMS}`,
        ],
      ],
    ];

    it('still open, as the same link', () => {
      for (const [newUrl, oldUrls] of cases) {
        const expected = parseSignalRoute(newUrl);
        assert.isNotNull(expected, newUrl);
        for (const oldUrl of oldUrls) {
          assert.deepEqual(parseSignalRoute(oldUrl), expected, oldUrl);
          assert.strictEqual(
            toSignalRouteWebUrl(oldUrl)?.toString(),
            newUrl,
            oldUrl
          );
        }
      }
    });

    it('keep their hosts on the blocklist: read, never fetched', () => {
      for (const [, oldUrls] of cases) {
        for (const oldUrl of oldUrls) {
          if (oldUrl.startsWith('https:')) {
            assert.isTrue(isSignalHost(oldUrl), oldUrl);
          }
        }
      }
    });
  });

  describe('in a message', () => {
    it('the new links count as the app’s own for link previews', () => {
      assert.isTrue(isGroupLink(`https://swarm.green/g/#${INVITE_CODE}`));
      assert.isTrue(
        isStickerPack(`https://swarm.green/stickers/#${STICKER_PARAMS}`)
      );
      assert.isTrue(isCallLink(`https://swarm.green/call/#key=${CALL_KEY}`));
      // and the old ones still do
      assert.isTrue(isGroupLink(`https://signal.group/#${INVITE_CODE}`));
      assert.isTrue(
        isStickerPack(`https://signal.art/addstickers/#${STICKER_PARAMS}`)
      );
      // but nothing else on swarm.green does
      assert.isFalse(isGroupLink('https://swarm.green/support'));
      assert.isFalse(isStickerPack('https://swarm.green/support'));
    });

    it('a swarm.green link is clickable, also typed without https://', () => {
      const text = `join swarm.green/g/#${INVITE_CODE} or https://swarm.green/u/#eu/${ENCRYPTED_USERNAME}`;
      const urls = (linkify.match(text) ?? []).map(match => match.url);
      assert.deepEqual(urls, [
        `http://swarm.green/g/#${INVITE_CODE}`,
        `https://swarm.green/u/#eu/${ENCRYPTED_USERNAME}`,
      ]);
    });
  });

  describe('QR codes', () => {
    function markPathsInBrandFile(): Array<string> {
      const svg = readFileSync(join(ROOT, 'images', 'swarm-mark.svg'), 'utf8');
      assert.include(svg, 'viewBox="0 0 1000 467.95"');
      return [...svg.matchAll(/<path[^>]* d="([^"]+)"/g)].map(
        match => match[1] ?? ''
      );
    }

    it('carry the SWARM mark exactly as in images/swarm-mark.svg', () => {
      assert.deepEqual([...SWARM_MARK_PATHS], markPathsInBrandFile());
      assert.strictEqual(SWARM_MARK_VIEWBOX_WIDTH, 1000);
      assert.strictEqual(SWARM_MARK_VIEWBOX_HEIGHT, 467.95);
    });

    it('draw the mark, centred, and not Signal’s logo', () => {
      const markup = renderToStaticMarkup(
        <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
          <BrandedQRCode
            size={16}
            link={`https://swarm.green/u/#eu/${ENCRYPTED_USERNAME}`}
            color="#d66400"
          />
        </svg>
      );
      for (const d of SWARM_MARK_PATHS) {
        assert.include(markup, `d="${d}"`);
      }
      assert.include(markup, 'viewBox="0 0 1000 467.95"');
      // 36 wide, 36 * 467.95 / 1000 high, centred in the 36 x 36 logo square.
      const height = (36 * 467.95) / 1000;
      assert.include(markup, `y="${(36 - height) / 2}"`);
      assert.include(markup, 'width="36"');
      assert.include(markup, `height="${height}"`);
      // Fragments of Signal's speech-bubble logo path.
      assert.notInclude(markup, 'M16.904 32.723');
      assert.notInclude(markup, 'M11.66 7.265');
    });
  });

  describe('username card colour', () => {
    const knownColors = new Set<number>(
      Object.values(Proto.AccountRecord.UsernameLink.Color).filter(
        (value): value is number => typeof value === 'number'
      )
    );

    it('defaults to SWARM orange (Hive Orange in the stylesheet)', () => {
      const variables = readFileSync(
        join(ROOT, 'stylesheets', '_variables.scss'),
        'utf8'
      );
      assert.match(variables, /\$color-ultramarine: #ff8a1f;/);
      assert.strictEqual(DEFAULT_PRESET.bg, '#ff8a1f');
      assert.strictEqual(
        DEFAULT_COLOR_ID,
        Proto.AccountRecord.UsernameLink.Color.ORANGE
      );
      assert.strictEqual(COLOR_MAP.get(DEFAULT_COLOR_ID), DEFAULT_PRESET);
      // A card whose colour was never chosen falls back to the default.
      assert.isUndefined(
        COLOR_MAP.get(Proto.AccountRecord.UsernameLink.Color.UNKNOWN)
      );
      assert.strictEqual([...COLOR_MAP.keys()][0], DEFAULT_COLOR_ID);
    });

    it('offers only colour ids every other device already knows', () => {
      for (const colorId of COLOR_MAP.keys()) {
        assert.isTrue(knownColors.has(colorId), String(colorId));
      }
      assert.strictEqual(
        COLOR_MAP.size,
        knownColors.size - 1,
        'all but UNKNOWN'
      );
    });
  });
});
