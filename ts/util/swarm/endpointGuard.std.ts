// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1). Two things must never happen in a SWARM Messenger build:
// it must never talk to Signal's servers, and it must never pretend to work
// while a server-generated parameter is still a placeholder. Both are checked
// here, as pure functions, so ts/test-node/swarm/ can test them and
// app/swarmStartupGuard.main.ts can run them before any window opens.

/** Marker used in config/*.json for a value Opus M-B's server has to generate. */
export const SWARM_PLACEHOLDER_PREFIX = 'SWARM-PLACEHOLDER-';

/** Hostname suffixes that belong to Signal and must never be contacted. */
export const SIGNAL_HOST_SUFFIXES: ReadonlyArray<string> = [
  'signal.org',
  'signalcaptchas.org',
  'whispersystems.org',
  'signal.art',
  'signal.me',
  'signal.group',
  'signal.link',
  'signal.tube',
];

export type EndpointConfigType = Readonly<{
  serverUrl?: string;
  storageUrl?: string;
  cdnUrl0?: string;
  cdnUrl2?: string;
  cdnUrl3?: string;
  sfuUrl?: string;
  challengeUrl?: string;
  registrationChallengeUrl?: string;
  contentProxyUrl?: string;
  updatesUrl?: string;
  resourcesUrl?: string;
}>;

export type ParamConfigType = Readonly<{
  serverPublicParams?: string;
  genericServerPublicParams?: string;
  backupServerPublicParams?: string;
  serverTrustRoots?: ReadonlyArray<string>;
  certificateAuthority?: string;
}>;

function hostnameOf(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** True when a URL points at a host Signal owns. */
export function isSignalHost(value: string): boolean {
  const hostname = hostnameOf(value);
  if (hostname === undefined) {
    // Not a URL: fall back to a substring check so that a bare host or a
    // half-written value cannot slip through.
    const lowered = value.toLowerCase();
    return SIGNAL_HOST_SUFFIXES.some(suffix => lowered.includes(suffix));
  }
  return SIGNAL_HOST_SUFFIXES.some(
    suffix => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
}

/**
 * Throws instead of letting a download go to Signal.
 *
 * For the few places that fetch a URL which is not in config/ and so is not
 * seen by the startup guard. `build/optional-resources.json` is one: upstream's
 * `scripts/get-emoji-locales.mjs` and `scripts/get-jumbomoji.mjs` regenerate it
 * with Signal's resource host, and before this check the app fetched the emoji
 * search index for the user's locale from there on every start.
 */
export function refuseSignalUrl(url: string, what: string): void {
  if (isSignalHost(url)) {
    throw new Error(
      `SWARM: refusing to fetch ${what} from a Signal host (${url}). ` +
        'SWARM Messenger never contacts Signal; point it at a SWARM host.'
    );
  }
}

/**
 * Every configured endpoint that points at Signal, as `key: url` pairs.
 * Empty means the build is clean.
 */
export function findSignalEndpoints(
  config: EndpointConfigType
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value !== '' && isSignalHost(value)) {
      problems.push(`${key}: ${value}`);
    }
  }
  return problems;
}

/** Every server-generated parameter that is still a placeholder. */
export function findPlaceholderParams(
  config: ParamConfigType
): ReadonlyArray<string> {
  const problems: Array<string> = [];
  const check = (key: string, value: unknown) => {
    if (
      typeof value === 'string' &&
      value.startsWith(SWARM_PLACEHOLDER_PREFIX)
    ) {
      problems.push(key);
    }
  };

  check('serverPublicParams', config.serverPublicParams);
  check('genericServerPublicParams', config.genericServerPublicParams);
  check('backupServerPublicParams', config.backupServerPublicParams);
  check('certificateAuthority', config.certificateAuthority);
  (config.serverTrustRoots ?? []).forEach((root, index) => {
    check(`serverTrustRoots[${index}]`, root);
  });

  return problems;
}

export type LibsignalNetTargetType =
  | 'signal-production'
  | 'signal-staging'
  | 'swarm-production'
  | 'swarm-staging'
  | 'local-test-server'
  | 'unsupported-custom-host';

/** The chat host compiled into `Net.Environment.Swarm`. */
export const SWARM_CHAT_HOST = 'chat.swarm.green';

/** The chat host compiled into `Net.Environment.SwarmStaging`. */
export const SWARM_STAGING_CHAT_HOST = 'staging.chat.swarm.green';

/**
 * Which libsignal-net environment a serverUrl resolves to.
 *
 * SWARM change (M2): `@signalapp/libsignal-client` 0.101.2-swarm.1 — the build
 * from Swarm-Official/swarm-libsignal, vendored in `vendor/` — adds
 * `Environment.Swarm` (chat.swarm.green) and `Environment.SwarmStaging`
 * (staging.chat.swarm.green) beside Signal's own `Staging` and `Production`.
 * The hostnames are compiled into the Rust crate, so only those two SWARM names
 * work: every other custom host still resolves to 'unsupported-custom-host'
 * rather than quietly falling back to Signal production, which is what upstream
 * did. See docs/SWARM-CONFIG.md and shared/libsignal-swarm.md.
 */
export function describeLibsignalNetTarget(
  serverUrl: string
): LibsignalNetTargetType {
  const hostname = hostnameOf(serverUrl);
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  ) {
    return 'local-test-server';
  }
  if (isSignalHost(serverUrl)) {
    return /staging/i.test(serverUrl) ? 'signal-staging' : 'signal-production';
  }
  if (hostname === SWARM_CHAT_HOST) {
    return 'swarm-production';
  }
  if (hostname === SWARM_STAGING_CHAT_HOST) {
    return 'swarm-staging';
  }
  return 'unsupported-custom-host';
}

/**
 * The plain-language message shown when a build is misconfigured. One string,
 * no jargon, so that whoever sees it knows what to fix.
 */
export function describeStartupRefusal({
  signalEndpoints,
  placeholders,
}: {
  signalEndpoints: ReadonlyArray<string>;
  placeholders: ReadonlyArray<string>;
}): string | undefined {
  const parts: Array<string> = [];

  if (signalEndpoints.length > 0) {
    parts.push(
      'This build is pointed at Signal’s servers, which SWARM Messenger ' +
        'must never contact:\n  ' +
        signalEndpoints.join('\n  ') +
        '\n\nFix the endpoints in config/ (see docs/SWARM-CONFIG.md) and ' +
        'rebuild.'
    );
  }

  if (placeholders.length > 0) {
    parts.push(
      'This build still carries placeholder values for parameters that only ' +
        'the SWARM chat server can generate:\n  ' +
        placeholders.join('\n  ') +
        '\n\nCopy them from shared/staging-public-params.json into config/ ' +
        '(see docs/SWARM-CONFIG.md) and rebuild. Until then SWARM Messenger ' +
        'cannot verify anything the server says, so it will not start.'
    );
  }

  if (parts.length === 0) {
    return undefined;
  }

  return `SWARM Messenger cannot start.\n\n${parts.join('\n\n')}`;
}
