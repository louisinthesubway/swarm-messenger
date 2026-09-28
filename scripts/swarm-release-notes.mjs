// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
// @ts-check
//
// SWARM addition (M4): hash the desktop installers and write the text of the
// GitHub pre-release that carries them. The `release` job of
// .github/workflows/swarm-build.yml runs it; it runs locally as well.
//
//   node scripts/swarm-release-notes.mjs <dir> <notes.md>
//
// It
//  - checks that <dir> holds exactly one file of each kind SWARM ships
//    (.exe, .deb, .AppImage, .dmg, .zip) and nothing else,
//  - writes <dir>/SHA256SUMS.txt over every one of them, in the format that
//    `sha256sum -c` and `shasum -a 256 -c` check,
//  - writes <notes.md>, the release body,
//  - prints the tag and the release name, and appends `tag=` and `name=` to
//    $GITHUB_OUTPUT when that is set.
//
// The tag is swarm-messenger-desktop-<yyyymmdd>-<shortsha>. The date is the
// commit's (UTC), not the build's, so running the workflow again for the same
// commit updates that commit's release instead of making a second one.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import packageJson from '../package.json' with { type: 'json' };

const SUMS = 'SHA256SUMS.txt';

// One file of each kind, in the order the release lists them.
const KINDS = ['.exe', '.deb', '.AppImage', '.dmg', '.zip'];

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * @param {string} ref
 * @returns {string} the commit's date as yyyymmdd, UTC
 */
function commitDate(ref) {
  const seconds = Number(
    execFileSync('git', ['show', '-s', '--format=%ct', ref], {
      encoding: 'utf8',
    }).trim()
  );
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Cannot read the commit date of ${ref}`);
  }
  return new Date(seconds * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

async function main() {
  const [dir, notesPath] = process.argv.slice(2);
  if (!dir || !notesPath) {
    console.error(
      'usage: node scripts/swarm-release-notes.mjs <dir> <notes.md>'
    );
    process.exit(2);
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && entry.name !== SUMS)
    .map(entry => entry.name)
    .sort();

  /** @type {Map<string, string>} */
  const byKind = new Map();
  const problems = [];
  for (const kind of KINDS) {
    const matching = files.filter(name => name.endsWith(kind));
    const [only] = matching;
    if (matching.length === 1 && only !== undefined) {
      byKind.set(kind, only);
    } else {
      problems.push(
        `expected exactly one ${kind}, found ${matching.length}` +
          (matching.length ? `: ${matching.join(', ')}` : '')
      );
    }
  }
  const unexpected = files.filter(
    name => !KINDS.some(kind => name.endsWith(kind))
  );
  if (unexpected.length > 0) {
    problems.push(`unexpected file(s): ${unexpected.join(', ')}`);
  }
  if (problems.length > 0) {
    console.error(`swarm-release-notes: ${dir} is not a complete release:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  /** @param {string} kind */
  const fileOf = kind => {
    const name = byKind.get(kind);
    if (name === undefined) {
      throw new Error(`missing ${kind}`);
    }
    return name;
  };

  const ordered = KINDS.map(fileOf);
  const sums = [];
  for (const name of ordered) {
    // One file at a time: they are large, and this runs once per release.
    // oxlint-disable-next-line no-await-in-loop
    sums.push(`${await sha256(join(dir, name))}  ${name}`);
  }
  const sumsText = `${sums.join('\n')}\n`;
  await writeFile(join(dir, SUMS), sumsText);

  const sha =
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const shortSha = sha.slice(0, 7);
  const { version } = packageJson;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo =
    process.env.GITHUB_REPOSITORY ?? 'Swarm-Official/swarm-messenger';
  const runId = process.env.GITHUB_RUN_ID;
  const runUrl = runId ? `${server}/${repo}/actions/runs/${runId}` : undefined;

  const tag = `swarm-messenger-desktop-${commitDate(sha)}-${shortSha}`;
  const name = `SWARM Messenger desktop (${version}, ${shortSha})`;

  const exe = fileOf('.exe');
  const deb = fileOf('.deb');
  const appImage = fileOf('.AppImage');
  const dmg = fileOf('.dmg');
  const zip = fileOf('.zip');

  const notes = [
    `Desktop builds of SWARM Messenger **${version}** from commit ` +
      `[\`${shortSha}\`](${server}/${repo}/commit/${sha})` +
      (runUrl ? `, built by [this run](${runUrl}).` : '.'),
    '',
    '**Nothing here is signed yet.** Windows SmartScreen, macOS Gatekeeper ' +
      'and apt will warn; that is expected for this pre-release. Compare the ' +
      'file you downloaded with its SHA-256 below before you run it.',
    '',
    '### Install',
    '',
    `**Windows 10 or 11, x64:** \`${exe}\``,
    '- Run the .exe. If SmartScreen stops it, choose "More info", then "Run anyway".',
    '- It installs for your Windows user only and starts SWARM Messenger.',
    '',
    `**Linux, x64:** \`${deb}\` or \`${appImage}\``,
    `- Debian or Ubuntu: \`sudo apt install ./${deb}\`, then start SWARM Messenger from the app menu or with \`swarm-messenger\`.`,
    `- Other distributions: \`chmod +x ${appImage}\`, then run \`./${appImage}\` (it needs FUSE 2, for example the \`libfuse2\` package).`,
    '',
    `**macOS, Apple Silicon:** \`${dmg}\` (the same app as \`${zip}\`)`,
    '- Open the .dmg and drag SWARM Messenger into Applications.',
    '- Then run `xattr -dr com.apple.quarantine "/Applications/SWARM Messenger.app"` in Terminal once, and open the app.',
    '',
    'There is no Intel Mac build: the SWARM build of libsignal has no macOS x64 library yet.',
    '',
    '### SHA-256',
    '',
    '```',
    sumsText.trimEnd(),
    '```',
    '',
    `The same list is attached as \`${SUMS}\`. To hash the file you ` +
      'downloaded: `sha256sum <file>` (Linux), `shasum -a 256 <file>` ' +
      '(macOS) or `Get-FileHash <file> -Algorithm SHA256` (Windows ' +
      'PowerShell).',
    '',
    'What each file is, how it is built and how to install it: ' +
      `[docs/RELEASES.md](${server}/${repo}/blob/${sha}/docs/RELEASES.md).`,
    '',
  ].join('\n');
  await writeFile(notesPath, notes);

  process.stdout.write(`tag:  ${tag}\nname: ${name}\n\n${sumsText}`);

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    await appendFile(output, `tag=${tag}\nname=${name}\n`);
  }
}

await main();
