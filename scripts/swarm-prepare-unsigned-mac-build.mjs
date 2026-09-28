// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
//
// SWARM addition (M4): make package.json build an ad-hoc-signed, un-notarized
// macOS app, for CI. Run it in the CI workspace right before
// `pnpm run build:release`; its change to package.json is never committed.
//
//   node scripts/swarm-prepare-unsigned-mac-build.mjs
//
// This is the same approach as upstream's prepare_*_build.mjs scripts, which
// also rewrite package.json in the CI workspace only.
//
// Three keys change, each because there is no Apple Developer ID yet:
//
//  - build.mac.sign is removed. It names scripts/sign-macos.mjs, which hands
//    the app to Signal's own signing script (SIGN_MACOS_SCRIPT) and throws
//    without one.
//  - build.mac.identity becomes "-", an ad-hoc signature. Apple Silicon does
//    not run code without a valid signature, and afterPack
//    (scripts/fuse-electron.mjs) rewrites the Electron binary, which voids the
//    ad-hoc signature it came with. electron-builder signs the whole bundle
//    again, ad hoc, after afterPack.
//  - build.mac.hardenedRuntime becomes false. With the hardened runtime on,
//    library validation only loads libraries signed by Apple or by the app's
//    own Team ID, and an ad-hoc signature has no Team ID, so the app could
//    not load its own Electron framework. The hardened runtime is there for
//    notarization, which needs a Developer ID anyway.
//
// The entitlements, icon, targets and everything else are left alone, so the
// signed build made later on the owner's Mac differs from this one only in
// these three keys - see docs/RELEASES.md.

import fs from 'node:fs';
import packageJson from '../package.json' with { type: 'json' };

/** @type {Record<string, unknown>} */
const mac = packageJson.build.mac;

delete mac.sign;
mac.identity = '-';
mac.hardenedRuntime = false;

console.log(
  'swarm-prepare-unsigned-mac-build: build.mac.sign removed, ' +
    'build.mac.identity "-" (ad hoc), build.mac.hardenedRuntime false'
);

fs.writeFileSync('./package.json', JSON.stringify(packageJson, null, '  '));
