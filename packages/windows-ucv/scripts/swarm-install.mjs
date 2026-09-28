// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM change (M1): this addon is Windows-only and needs MSVC. The SWARM build
// workstation has no Visual Studio and cannot get one (system drive full), so a
// developer there sets SWARM_ALLOW_MISSING_NATIVE=1 and the build is skipped with
// a loud warning; Windows Hello / OS re-authentication then reports itself as
// unsupported at runtime (see ../index.ts). CI does NOT set that variable, so a
// release build still fails if the addon cannot be compiled.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'win32') {
  process.stdout.write(
    `@signalapp/windows-ucv: skipping native build on ${process.platform} ` +
      '(Windows-only addon)\n',
  );
  process.exit(0);
}

const result = spawnSync('node-gyp', ['rebuild'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status === 0) {
  process.exit(0);
}

if (process.env.SWARM_ALLOW_MISSING_NATIVE === '1') {
  process.stderr.write(
    '\n@signalapp/windows-ucv: NATIVE BUILD FAILED and SWARM_ALLOW_MISSING_NATIVE=1\n' +
      'is set, so the install continues. This build of SWARM Messenger cannot use\n' +
      'Windows Hello / OS re-authentication: promptOSAuth() will report\n' +
      '"unsupported". Never ship such a build - CI does not set this variable.\n\n',
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
