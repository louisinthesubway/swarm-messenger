// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM change (M1): this addon is macOS-only. Its binding.gyp declares a `noop`
// target everywhere else, but node-gyp still runs its *configure* step, and on
// Windows configure insists on a Visual Studio installation even for a target
// that compiles nothing. On a machine without Visual Studio that turns the whole
// `pnpm install` into a failure for a module that is never loaded on that
// platform. So: run node-gyp only on macOS, and say plainly what we skipped.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.platform !== 'darwin') {
  process.stdout.write(
    `@signalapp/mute-state-change: skipping native build on ${process.platform} ` +
      '(macOS-only addon; index.mjs already falls back to a no-op)\n'
  );
  process.exit(0);
}

const result = spawnSync('node-gyp', ['rebuild'], {
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
