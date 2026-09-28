// Copyright 2025 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { Net } from '@signalapp/libsignal-client';

import { getUserAgent } from '../util/getUserAgent.node.ts';
import { getMockServerPort } from '../util/getMockServerPort.dom.ts';
import { isMockServer } from '../util/isMockServer.dom.ts';
import { describeLibsignalNetTarget } from '../util/swarm/endpointGuard.std.ts';
import { pemToDer } from '../util/pemToDer.std.ts';
import { drop } from '../util/drop.std.ts';
import { toLogFormat } from '../types/errors.std.ts';
import { createLogger } from '../logging/log.std.ts';

const log = createLogger('preconnect');

// Libsignal has internally configured values for domain names
// (and other connectivity params) of the services.
function resolveLibsignalNet(
  url: string,
  version: string,
  certificateAuthority?: string
): Net.Net {
  const userAgent = getUserAgent(version);
  log.info(`libsignal net url: ${url}`);
  // SWARM change (M1, extended in M2): libsignal-net's environments are compiled
  // into the Rust crate, and upstream fell through to Net.Environment.Production
  // for anything it did not recognise - which for a SWARM hostname would mean
  // talking to Signal's production servers. That must never happen. The SWARM
  // build of libsignal (0.101.2-swarm.1, vendored in vendor/) adds
  // Environment.Swarm and Environment.SwarmStaging, so the two SWARM chat hosts
  // are now real branches; everything else still refuses, in words that say what
  // has to change.
  //
  // The SWARM host is decided first, and from the hostname alone. Upstream chose
  // Net.Environment.Staging from isStagingServer(), which is true whenever
  // NODE_ENV=staging - and that environment is *Signal's* staging network, so a
  // SWARM staging build would have gone to Signal. That check is gone.
  const swarmTarget = describeLibsignalNetTarget(url);
  if (swarmTarget === 'signal-staging' || swarmTarget === 'signal-production') {
    throw new Error(
      `SWARM Messenger refuses to connect: serverUrl ${url} is a Signal ` +
        'server. Point serverUrl at a SWARM endpoint (see docs/SWARM-CONFIG.md).'
    );
  }
  if (swarmTarget === 'swarm-production') {
    log.info('libsignal net environment resolved to SWARM');
    return new Net.Net({
      env: Net.Environment.Swarm,
      userAgent,
    });
  }
  if (swarmTarget === 'swarm-staging') {
    log.info('libsignal net environment resolved to SWARM staging');
    return new Net.Net({
      env: Net.Environment.SwarmStaging,
      userAgent,
    });
  }
  if (swarmTarget === 'unsupported-custom-host') {
    throw new Error(
      `SWARM Messenger cannot reach ${url}. libsignal-net only knows ` +
        'chat.swarm.green, staging.chat.swarm.green and a loopback test ' +
        'server - its hostnames are compiled in. Point serverUrl at one of ' +
        'those, or run the SWARM chat server at https://localhost:<port> ' +
        '(directly or through a tunnel) with its root certificate in the ' +
        'certificateAuthority config value. See docs/SWARM-CONFIG.md.'
    );
  }

  // Only 'local-test-server' can still be here. Upstream checked
  // isStagingServer() at this point (Net.Environment.Staging is Signal's staging
  // network) and fell back to Net.Environment.Production; both are gone, so
  // there is no path left from this function to a Signal host.
  if (isMockServer(url) && certificateAuthority !== undefined) {
    const DISCARD_PORT = 9; // Reserved by RFC 863.
    log.info('libsignal net environment resolved to mock');
    return new Net.Net({
      localTestServer: true,
      userAgent,
      TESTING_localServer_chatPort: parseInt(getMockServerPort(url), 10),
      TESTING_localServer_cdsiPort: DISCARD_PORT,
      TESTING_localServer_svr2Port: DISCARD_PORT,
      TESTING_localServer_svrBPort: DISCARD_PORT,
      TESTING_localServer_rootCertificateDer: pemToDer(certificateAuthority),
      TESTING_localServer_httpVersion: 2,
    });
  }

  throw new Error(
    `SWARM Messenger cannot reach ${url}: a loopback serverUrl needs the test ` +
      "server's root certificate in the certificateAuthority config value " +
      '(see docs/SWARM-CONFIG.md).'
  );
}

// `libsignalNet` is an instance of a class from libsignal that is responsible
// for providing network layer API and related functionality.
// It's important to have a single instance of this class as it holds
// resources that are shared across all other use cases.
let libsignalNet: Net.Net | undefined;

// SWARM change (M1): when resolveLibsignalNet() refuses (see above), remember
// why. The app still starts and shows its window - the refusal surfaces the
// moment something actually needs the network, with the same explanation.
let libsignalNetError: Error | undefined;

export function getLibsignalNet(): Net.Net {
  if (libsignalNetError !== undefined) {
    // Callers capture this at module load, so we cannot throw here without
    // breaking the whole renderer. Hand back an object that throws the
    // explanation the first time anything actually touches the network.
    const error = libsignalNetError;
    return new Proxy({} as Net.Net, {
      get() {
        throw error;
      },
      set() {
        throw error;
      },
    });
  }
  if (libsignalNet === undefined) {
    throw new Error(
      'getLibsignalNet: no network layer - serverUrl is not configured'
    );
  }
  return libsignalNet;
}

/** SWARM addition: why there is no libsignal-net instance, if there is none. */
export function getLibsignalNetError(): Error | undefined {
  return libsignalNetError;
}

// Not defined in tests
if (window.SignalContext.config?.serverUrl) {
  const { config } = window.SignalContext;

  try {
    libsignalNet = resolveLibsignalNet(
      config.serverUrl,
      config.version,
      config.certificateAuthority
    );
  } catch (error) {
    libsignalNetError =
      error instanceof Error ? error : new Error(String(error));
    log.error(
      `SWARM: no libsignal network layer: ${libsignalNetError.message}`
    );
  }
}

const readyNet = libsignalNet;
if (readyNet !== undefined) {
  const { config } = window.SignalContext;

  readyNet.setIpv6Enabled(!config.disableIPv6);
  if (config.proxyUrl) {
    log.info('WebAPI: Setting libsignal proxy');
    try {
      readyNet.setProxyFromUrl(config.proxyUrl);
    } catch (error) {
      log.error(`WebAPI: Failed to set proxy: ${error}`);
      readyNet.clearProxy();
    }
  }

  drop(
    (async () => {
      try {
        log.info('WebAPI: preconnect start');
        await readyNet.preconnectChat();
        log.info('WebAPI: preconnect done');
      } catch (error) {
        log.error(`WebAPI: Failed to preconnect: ${toLogFormat(error)}`);
      }
    })()
  );
}
