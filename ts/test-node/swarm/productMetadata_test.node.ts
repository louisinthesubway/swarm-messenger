// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B2c). What the operating system, the installers and the
// About window say about the product: SWARM's names and addresses, the one URL
// scheme SWARM owns, and the licence notices in the Licences document rather
// than in the About window. Source-level checks, so an upstream merge that
// brings the old values back fails here before it reaches a package
// (scripts/swarm-brand-check.mjs then checks the packaged app).

import { assert } from 'chai';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

function read(...segments: Array<string>): string {
  return readFileSync(join(ROOT, ...segments), 'utf8');
}

type PackageJson = {
  desktopName: string;
  repository: string;
  homepage: string;
  scripts: Record<string, string>;
  build: {
    copyright: string;
    files: Array<unknown>;
    linux: { executableName: string };
    protocols: { schemes: Array<string> };
  };
};

const packageJson: PackageJson = JSON.parse(read('package.json'));

describe('SWARM: product metadata, URL schemes and the About window', () => {
  it('names the Linux desktop entry the package installs', () => {
    // electron-builder installs the entry as <executableName>.desktop, in the
    // .deb and in the AppImage alike, and Electron hands desktopName to
    // xdg-settings when it registers the swarm: scheme on Linux.
    assert.strictEqual(packageJson.desktopName, 'swarm-messenger.desktop');
    assert.strictEqual(
      packageJson.desktopName,
      `${packageJson.build.linux.executableName}.desktop`
    );
  });

  it("points the package metadata at SWARM's own pages", () => {
    assert.strictEqual(
      packageJson.repository,
      'https://github.com/louisinthesubway/swarm-messenger.git'
    );
    assert.strictEqual(packageJson.homepage, 'https://swarm.green');
    assert.strictEqual(packageJson.build.copyright, 'Copyright © 2026 SWARM');
  });

  it('registers the swarm: scheme and no other', () => {
    assert.deepStrictEqual(packageJson.build.protocols.schemes, ['swarm']);

    const main = read('app', 'main.main.ts');
    const registered = [
      ...main.matchAll(/setAsDefaultProtocolClient\('([^']+)'\)/g),
    ].map(match => match[1]);
    assert.deepStrictEqual(registered, ['swarm']);
  });

  it('opens no GitHub page from the Help menu or the About window', () => {
    const main = read('app', 'main.main.ts');
    const code = main
      .split('\n')
      .filter(line => !/^\s*(\/\/|\*)/.test(line))
      .join('\n');
    assert.notInclude(code, 'github.com');
    assert.include(code, "'https://swarm.green/ecosystem/messenger'");

    const about = read('ts', 'components', 'About.dom.tsx');
    assert.notInclude(about, 'github.com');
    assert.include(about, "i18n('icu:About__Licences')");
    assert.include(about, 'https://swarm.green/legal');
  });

  it('packages and generates the Licences document', () => {
    assert.include(packageJson.build.files, 'build/licences.html');
    assert.include(packageJson.scripts['generate:phase-1'], 'build:licences');
  });

  it('has no English string that names Signal', () => {
    const messages: Record<string, { messageformat?: string }> = JSON.parse(
      read('_locales', 'en', 'messages.json')
    );
    const offences = Object.entries(messages)
      .filter(
        ([key, { messageformat }]) =>
          key !== 'smartling' &&
          typeof messageformat === 'string' &&
          /\bSignal\b/.test(messageformat)
      )
      .map(([key, { messageformat }]) => `${key}: ${messageformat}`);
    assert.deepStrictEqual(offences, []);
    assert.strictEqual(
      messages['icu:About__Licences']?.messageformat,
      'Licences'
    );
  });

  it('keeps the retired attribution strings out of every language', () => {
    // They said, in the main window and the About window, what the Licences
    // document now says; in other languages the first one still said that
    // the upstream project is a nonprofit.
    const offences: Array<string> = [];
    for (const locale of readdirSync(join(ROOT, '_locales'))) {
      const messages = JSON.parse(read('_locales', locale, 'messages.json'));
      for (const key of [
        'icu:signalNonProfit',
        'icu:SwarmAbout__attribution',
      ]) {
        if (Object.hasOwn(messages, key)) {
          offences.push(`${locale} ${key}`);
        }
      }
    }
    assert.deepStrictEqual(offences, []);
  });
});
