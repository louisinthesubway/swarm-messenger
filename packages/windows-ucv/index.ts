// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import loadBinding from 'bindings';

export type Availability =
  | 'available'
  | 'deviceBusy'
  | 'deviceNotPresent'
  | 'disabledByPolicy'
  | 'notConfiguredForUser'
  | 'unknown';

export type Verification =
  | 'verified'
  | 'deviceBusy'
  | 'deviceNotPresent'
  | 'disabledByPolicy'
  | 'notConfiguredForUser'
  | 'retriesExhausted'
  | 'canceled'
  | 'unknown';

type AsyncError = 'canceled' | 'error' | Error;

type BindingType = Readonly<{
  checkAvailability(
    callback: (result: Availability | AsyncError) => void,
  ): void;
  requestVerification(
    message: string,
    callback: (result: Verification | AsyncError) => void,
  ): void;
}>;

let binding: BindingType | undefined;
let loadError: unknown;
if (process.platform === 'win32') {
  // SWARM change (M1): a development machine without Visual Studio cannot
  // compile this addon (see scripts/swarm-install.mjs). Do not crash the main
  // process at import time; report the OS check as unavailable instead.
  try {
    binding = loadBinding('windows-ucv');
  } catch (error) {
    loadError = error;
    // oxlint-disable-next-line no-console
    console.warn(
      '@signalapp/windows-ucv: native addon missing, OS re-authentication ' +
        'will report itself unsupported.',
      error,
    );
  }
}

/**
 * SWARM addition: true when the native addon is present and usable here, so
 * callers can degrade gracefully instead of throwing.
 */
export function isAvailable(): boolean {
  return binding !== undefined;
}

/** SWARM addition: why the addon could not be loaded, if it could not be. */
export function getLoadError(): unknown {
  return loadError;
}

/**
 * Check if User Constant Verification is available.
 *
 * See: https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier.checkavailabilityasync?view=winrt-26100#windows-security-credentials-ui-userconsentverifier-checkavailabilityasync
 */
export async function checkAvailability(): Promise<Availability> {
  if (!binding) {
    throw new Error('This library works only on Windows');
  }
  return new Promise((resolve, reject) => {
    binding.checkAvailability((result) => {
      if (result === 'canceled') {
        return reject(new Error('Canceled'));
      }
      if (result === 'error') {
        return reject(new Error('Internal error'));
      }
      if (result instanceof Error) {
        return reject(result);
      }

      return resolve(result);
    });
  });
}

/**
 * Request User Constant Verification
 *
 * See: https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.ui.userconsentverifier.requestverificationasync?view=winrt-26100
 */
export async function requestVerification(
  message: string,
): Promise<Verification> {
  if (!binding) {
    throw new Error('This library works only on Windows');
  }
  return new Promise((resolve, reject) => {
    binding.requestVerification(message, (result) => {
      if (result === 'canceled') {
        return reject(new Error('Canceled'));
      }
      if (result === 'error') {
        return reject(new Error('Internal error'));
      }
      if (result instanceof Error) {
        return reject(result);
      }

      return resolve(result);
    });
  });
}
