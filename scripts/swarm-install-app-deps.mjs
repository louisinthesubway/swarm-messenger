// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM change (M1): wrapper around `electron-builder install-app-deps`.
//
// Every native dependency SWARM Messenger actually needs ships a prebuilt,
// N-API binary (@signalapp/libsignal-client, @signalapp/sqlcipher,
// @signalapp/ringrtc, @indutny/simple-windows-notifications). The only modules
// that @electron/rebuild has to compile are the two workspace addons in
// packages/ (mute-state-change, macOS-only; windows-ucv, Windows-only), and
// compiling those on Windows needs Visual Studio.
//
// The SWARM build workstation has no Visual Studio and cannot get one (system
// drive full). A developer there sets SWARM_ALLOW_MISSING_NATIVE=1 and this
// wrapper reports the failure loudly and continues, so the app can still be run
// and developed locally. CI does not set the variable, so a release build still
// fails if a native module cannot be built.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const result = spawnSync('electron-builder', ['install-app-deps'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status === 0) {
  process.exit(0);
}

if (process.env.SWARM_ALLOW_MISSING_NATIVE === '1') {
  process.stderr.write(
    '\n' +
      '='.repeat(72) +
      '\nSWARM: electron-builder install-app-deps FAILED and\n' +
      'SWARM_ALLOW_MISSING_NATIVE=1 is set, so the install continues.\n' +
      'Optional native addons (Windows Hello re-authentication, macOS mute\n' +
      'state) will be missing from this tree. This is for local development\n' +
      'only - never publish a build made this way.\n' +
      '='.repeat(72) +
      '\n\n'
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
