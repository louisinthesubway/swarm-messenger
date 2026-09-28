// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1). Runs before any window opens.
//
// Two refusals:
//  1. Any configured endpoint that points at Signal. No override, ever: a SWARM
//     build must never contact Signal's servers.
//  2. Any server-generated parameter still left as a placeholder. A developer on
//     an unpackaged tree may continue past this one with
//     SWARM_ALLOW_PLACEHOLDER_CONFIG=1, which is how the app is run locally
//     before the staging chat server exists. A packaged build ignores the
//     variable, so an installer can never bypass the check.

import { app, dialog } from 'electron';
import type { Config } from 'config';

import {
  describeStartupRefusal,
  findPlaceholderParams,
  findSignalEndpoints,
} from '../ts/util/swarm/endpointGuard.std.ts';

function optionalString(config: Config, key: string): string | undefined {
  return config.has(key) ? config.get<string>(key) : undefined;
}

export function checkSwarmConfig(config: Config): {
  signalEndpoints: ReadonlyArray<string>;
  placeholders: ReadonlyArray<string>;
} {
  const signalEndpoints = findSignalEndpoints({
    serverUrl: optionalString(config, 'serverUrl'),
    storageUrl: optionalString(config, 'storageUrl'),
    cdnUrl0: optionalString(config, 'cdn.0'),
    cdnUrl2: optionalString(config, 'cdn.2'),
    cdnUrl3: optionalString(config, 'cdn.3'),
    sfuUrl: optionalString(config, 'sfuUrl'),
    challengeUrl: optionalString(config, 'challengeUrl'),
    registrationChallengeUrl: optionalString(
      config,
      'registrationChallengeUrl'
    ),
    contentProxyUrl: optionalString(config, 'contentProxyUrl'),
    updatesUrl: optionalString(config, 'updatesUrl'),
    resourcesUrl: optionalString(config, 'resourcesUrl'),
  });

  const placeholders = findPlaceholderParams({
    serverPublicParams: optionalString(config, 'serverPublicParams'),
    genericServerPublicParams: optionalString(
      config,
      'genericServerPublicParams'
    ),
    backupServerPublicParams: optionalString(
      config,
      'backupServerPublicParams'
    ),
    certificateAuthority: optionalString(config, 'certificateAuthority'),
    serverTrustRoots: config.has('serverTrustRoots')
      ? config.get<Array<string>>('serverTrustRoots')
      : undefined,
  });

  return { signalEndpoints, placeholders };
}

/**
 * Quits the app with a plain-language message when the configuration is not fit
 * to run. Returns normally when the build is fit to run.
 */
export function enforceSwarmConfig(
  config: Config,
  logger: { warn: (msg: string) => void; error: (msg: string) => void }
): void {
  const { signalEndpoints, placeholders } = checkSwarmConfig(config);

  const placeholdersMayBeIgnored =
    !app.isPackaged && process.env.SWARM_ALLOW_PLACEHOLDER_CONFIG === '1';

  const fatalPlaceholders = placeholdersMayBeIgnored ? [] : placeholders;

  if (placeholdersMayBeIgnored && placeholders.length > 0) {
    const banner = '='.repeat(72);
    logger.warn(
      `\n${banner}\nSWARM: running with PLACEHOLDER server parameters ` +
        `(${placeholders.join(', ')}).\nNothing the server says can be ` +
        'verified. Registration and messaging will not work.\nThis is allowed ' +
        'only because SWARM_ALLOW_PLACEHOLDER_CONFIG=1 and this is not a ' +
        `packaged build.\n${banner}\n`
    );
  }

  const message = describeStartupRefusal({
    signalEndpoints,
    placeholders: fatalPlaceholders,
  });

  if (message === undefined) {
    return;
  }

  logger.error(`SWARM startup guard refused to start:\n${message}`);
  dialog.showErrorBox('SWARM Messenger', message);
  app.exit(1);
  // app.exit() does not unwind the stack, but throwing makes the refusal
  // unmistakable if Electron ever changes that.
  throw new Error(message);
}
