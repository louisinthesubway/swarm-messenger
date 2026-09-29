// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
//
// SWARM addition (B2c): writes build/licences.html, the Licences document that
// the About window opens (app/main.main.ts showLicencesWindow), from
// package.json's build.copyright, LICENSE and ACKNOWLEDGMENTS.md. It runs in
// `pnpm run generate` (build:licences), after `pnpm install` has regenerated
// ACKNOWLEDGMENTS.md, and electron-builder packages the result through
// build.files. The file is generated, so it is not committed.
//
//   node --import=tsx scripts/swarm-generate-licences.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import packageJson from '../package.json' with { type: 'json' };
import { buildLicencesDocument } from '../ts/util/swarm/licencesDocument.std.ts';

const ROOT = join(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'build', 'licences.html');

const html = buildLicencesDocument({
  copyright: packageJson.build.copyright,
  licence: await readFile(join(ROOT, 'LICENSE'), 'utf8'),
  acknowledgments: await readFile(join(ROOT, 'ACKNOWLEDGMENTS.md'), 'utf8'),
});

await writeFile(OUTPUT, html);

console.log(
  `swarm-generate-licences: wrote build/licences.html (${Buffer.byteLength(html)} bytes)`
);
