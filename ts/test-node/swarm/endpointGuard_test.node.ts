// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1): tests for the startup guard, including the three config
// files themselves.

import { assert } from 'chai';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Net } from '@signalapp/libsignal-client';
import libsignalPackageJson from '@signalapp/libsignal-client/package.json';
import { GenericServerPublicParams } from '@signalapp/libsignal-client/zkgroup';

import {
  SWARM_CHAT_HOST,
  SWARM_STAGING_CHAT_HOST,
  describeLibsignalNetTarget,
  describeStartupRefusal,
  findPlaceholderParams,
  findSignalEndpoints,
  isSignalHost,
  refuseSignalUrl,
} from '../../util/swarm/endpointGuard.std.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function readConfig(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'config', name), 'utf8'));
}

const ENDPOINT_KEYS = [
  'serverUrl',
  'storageUrl',
  'contentProxyUrl',
  'sfuUrl',
  'challengeUrl',
  'registrationChallengeUrl',
  'updatesUrl',
  'resourcesUrl',
] as const;

describe('SWARM endpointGuard', () => {
  describe('isSignalHost', () => {
    it('recognises Signal hosts', () => {
      assert.isTrue(isSignalHost('https://chat.signal.org'));
      assert.isTrue(isSignalHost('https://chat.staging.signal.org'));
      assert.isTrue(isSignalHost('https://signalcaptchas.org/challenge'));
      assert.isTrue(isSignalHost('https://updates2.signal.org/desktop'));
      assert.isTrue(isSignalHost('http://contentproxy.signal.org:443'));
    });

    it('does not mistake a SWARM host for a Signal one', () => {
      assert.isFalse(isSignalHost('https://chat.swarm.green'));
      assert.isFalse(isSignalHost('https://cdn.chat.swarm.green'));
      assert.isFalse(isSignalHost('https://localhost:8080'));
    });

    it('is not fooled by a lookalike host', () => {
      assert.isFalse(isSignalHost('https://signal.org.example.com'));
      assert.isFalse(isSignalHost('https://notsignal.green'));
    });
  });

  describe('refuseSignalUrl', () => {
    it('throws, naming what was refused, for a Signal URL', () => {
      assert.throws(
        () =>
          refuseSignalUrl(
            'https://updates2.signal.org/static/android/emoji/search/18/en.json',
            'optional resource emoji-index-en.json'
          ),
        /refusing to fetch optional resource emoji-index-en\.json from a Signal host/
      );
    });

    it('lets a SWARM URL through', () => {
      assert.doesNotThrow(() =>
        refuseSignalUrl(
          'https://static.swarm.green/static/android/emoji/search/18/en.json',
          'optional resource emoji-index-en.json'
        )
      );
    });
  });

  describe('findSignalEndpoints', () => {
    it('reports every offending key', () => {
      const problems = findSignalEndpoints({
        serverUrl: 'https://chat.signal.org',
        storageUrl: 'https://storage.chat.swarm.green',
        challengeUrl: 'https://signalcaptchas.org/challenge/generate.html',
      });
      assert.lengthOf(problems, 2);
      assert.isTrue(problems.some(p => p.startsWith('serverUrl:')));
      assert.isTrue(problems.some(p => p.startsWith('challengeUrl:')));
    });

    it('is empty for a clean SWARM config', () => {
      assert.deepStrictEqual(
        findSignalEndpoints({
          serverUrl: 'https://chat.swarm.green',
          storageUrl: 'https://storage.chat.swarm.green',
        }),
        []
      );
    });
  });

  describe('findPlaceholderParams', () => {
    it('names each placeholder, including inside serverTrustRoots', () => {
      const problems = findPlaceholderParams({
        serverPublicParams: 'SWARM-PLACEHOLDER-serverPublicParams',
        genericServerPublicParams: 'AYhaw+Nbxt',
        serverTrustRoots: ['BbqY1Dzo', 'SWARM-PLACEHOLDER-serverTrustRoots'],
      });
      assert.deepStrictEqual(problems, [
        'serverPublicParams',
        'serverTrustRoots[1]',
      ]);
    });

    it('is empty once real values are wired in', () => {
      assert.deepStrictEqual(
        findPlaceholderParams({
          serverPublicParams: 'AByD8',
          genericServerPublicParams: 'AYhaw',
          backupServerPublicParams: 'AXYrGb',
          serverTrustRoots: ['BbqY1Dzo'],
        }),
        []
      );
    });
  });

  describe('describeLibsignalNetTarget', () => {
    it('knows the loopback test server', () => {
      assert.strictEqual(
        describeLibsignalNetTarget('https://localhost:8080'),
        'local-test-server'
      );
      assert.strictEqual(
        describeLibsignalNetTarget('https://127.0.0.1:8080'),
        'local-test-server'
      );
    });

    it('knows Signal', () => {
      assert.strictEqual(
        describeLibsignalNetTarget('https://chat.signal.org'),
        'signal-production'
      );
      assert.strictEqual(
        describeLibsignalNetTarget('https://chat.staging.signal.org'),
        'signal-staging'
      );
    });

    it('knows the two SWARM chat hosts libsignal compiles in', () => {
      // M2: @signalapp/libsignal-client 0.101.2-swarm.1 adds Environment.Swarm
      // and Environment.SwarmStaging. serverUrl must be one of these exact
      // hostnames, because libsignal takes the host from its own tables.
      assert.strictEqual(
        describeLibsignalNetTarget('https://chat.swarm.green'),
        'swarm-production'
      );
      assert.strictEqual(
        describeLibsignalNetTarget('https://staging.chat.swarm.green'),
        'swarm-staging'
      );
    });

    it('still refuses to guess for any other custom host', () => {
      // This is the finding that mattered in M1 and still does: upstream fell
      // through to Signal production for anything it did not recognise. Only
      // the two compiled-in SWARM names work; a sibling SWARM name does not.
      for (const url of [
        'https://cdn.chat.swarm.green',
        'https://chat.swarm.green.example.com',
        'https://swarm.green',
        'https://example.com',
      ]) {
        assert.strictEqual(
          describeLibsignalNetTarget(url),
          'unsupported-custom-host',
          url
        );
      }
    });
  });

  describe('describeStartupRefusal', () => {
    it('says nothing when the build is fit to run', () => {
      assert.isUndefined(
        describeStartupRefusal({ signalEndpoints: [], placeholders: [] })
      );
    });

    it('names the Signal endpoints in plain language', () => {
      const message = describeStartupRefusal({
        signalEndpoints: ['serverUrl: https://chat.signal.org'],
        placeholders: [],
      });
      assert.include(message ?? '', 'SWARM Messenger cannot start.');
      assert.include(message ?? '', 'https://chat.signal.org');
      assert.include(message ?? '', 'docs/SWARM-CONFIG.md');
    });

    it('names the placeholders in plain language', () => {
      const message = describeStartupRefusal({
        signalEndpoints: [],
        placeholders: ['serverPublicParams'],
      });
      assert.include(message ?? '', 'serverPublicParams');
      assert.include(message ?? '', 'shared/staging-public-params.json');
    });
  });

  describe('the shipped config files', () => {
    for (const name of [
      'default.json',
      'production.json',
      'swarm-staging.json',
    ]) {
      it(`${name} points at no Signal endpoint`, () => {
        const config = readConfig(name);
        const cdn = (config.cdn ?? {}) as Record<string, string>;
        const problems = findSignalEndpoints({
          ...Object.fromEntries(
            ENDPOINT_KEYS.map(key => [key, config[key] as string | undefined])
          ),
          cdnUrl0: cdn['0'],
          cdnUrl2: cdn['2'],
          cdnUrl3: cdn['3'],
        });
        assert.deepStrictEqual(problems, []);
      });

      it(`${name} has no Stripe key and no update feed`, () => {
        const config = readConfig(name);
        assert.notProperty(config, 'stripePublishableKey');
        assert.notProperty(config, 'updatesPublicKey');
        assert.notProperty(config, 'appImageUpdatesPublicKey');
        if (name !== 'swarm-staging.json') {
          assert.strictEqual(config.updatesEnabled, false);
        }
      });
    }

    // SWARM addition (M-H): genericServerPublicParams verifies calling
    // credentials (the server's callingZkConfig), backupServerPublicParams
    // backup credentials (chatZkConfig). Until 2026-09-27 both carried the chat
    // set, and every call-link credential - which arrives with the group auth
    // credentials - failed to verify, so no group could be created.
    it('carries two different generic zk sets, the same in all three files', () => {
      const staging = readConfig('swarm-staging.json');
      const calling = staging.genericServerPublicParams as string;
      const backup = staging.backupServerPublicParams as string;
      for (const name of ['default.json', 'production.json']) {
        const other = readConfig(name);
        assert.strictEqual(
          other.genericServerPublicParams,
          calling,
          `${name} genericServerPublicParams must match config/swarm-staging.json`
        );
        assert.strictEqual(
          other.backupServerPublicParams,
          backup,
          `${name} backupServerPublicParams must match config/swarm-staging.json`
        );
      }
      assert.notStrictEqual(
        calling,
        backup,
        'genericServerPublicParams is the calling set and must not be the backup (chat) set'
      );
      for (const value of [calling, backup]) {
        assert.doesNotThrow(
          () => new GenericServerPublicParams(Buffer.from(value, 'base64'))
        );
      }
    });

    it('default.json and production.json match swarm-staging.json endpoint for endpoint', () => {
      const staging = readConfig('swarm-staging.json');
      for (const name of ['default.json', 'production.json']) {
        const other = readConfig(name);
        for (const key of ENDPOINT_KEYS) {
          assert.strictEqual(
            other[key],
            staging[key],
            `${name} ${key} must match config/swarm-staging.json`
          );
        }
        assert.deepStrictEqual(
          other.cdn,
          staging.cdn,
          `${name} cdn must match config/swarm-staging.json`
        );
      }
    });
  });

  // SWARM addition (M2): the guard above is only meaningful if the installed
  // libsignal is the SWARM build. If someone resolves @signalapp/libsignal-client
  // back to the npm release, Environment.Swarm disappears and the chat host in
  // config/ can no longer be reached - so assert the build, not just the config.
  describe('the installed libsignal build', () => {
    it('is the SWARM build, with the hosts config/ points at', () => {
      const { version, swarm } = libsignalPackageJson as {
        version: string;
        swarm?: { chatHost?: string; stagingChatHost?: string };
      };
      assert.match(
        version,
        /-swarm\.\d+$/,
        `installed @signalapp/libsignal-client is ${version}, not a SWARM build ` +
          '(see vendor/ and shared/libsignal-swarm.md)'
      );
      assert.strictEqual(swarm?.chatHost, SWARM_CHAT_HOST);
      assert.strictEqual(swarm?.stagingChatHost, SWARM_STAGING_CHAT_HOST);
    });

    it('exposes the two SWARM network environments', () => {
      assert.strictEqual(Net.Environment.Swarm, 2);
      assert.strictEqual(Net.Environment.SwarmStaging, 3);
    });

    it('agrees with serverUrl in every shipped config file', () => {
      for (const name of [
        'swarm-staging.json',
        'default.json',
        'production.json',
      ]) {
        const serverUrl = readConfig(name).serverUrl as string;
        // libsignal takes the chat host from its own compiled-in tables, not
        // from this URL, so a mismatch would send the websocket to one host and
        // the REST API to another.
        assert.include(
          [SWARM_CHAT_HOST, SWARM_STAGING_CHAT_HOST],
          new URL(serverUrl).hostname,
          `${name} serverUrl ${serverUrl} is not a host libsignal can reach`
        );
      }
    });
  });
});
