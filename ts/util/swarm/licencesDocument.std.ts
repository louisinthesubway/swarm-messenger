// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B2c): the Licences document. The About window no longer
// shows licence text; its "Licences" entry opens this one page instead, which
// ships inside the app as build/licences.html (written by
// scripts/swarm-generate-licences.mjs during `pnpm run generate`), so it needs
// no website and no GitHub. It carries, in this order: the paragraph below,
// the product's copyright line, the full AGPL-3.0 text (LICENSE) and the
// third-party notices (ACKNOWLEDGMENTS.md). The AGPL-3.0 requires the notices
// and the offer of the source code; nothing here may be dropped or shortened.

export const SWARM_SOURCE_CODE_URL =
  'https://github.com/louisinthesubway/swarm-messenger';

// The paragraph the document opens with, word for word as the licence
// decision (2026-09-29) states it.
export const LICENCES_INTRODUCTION =
  'SWARM Messenger is free software under the GNU Affero General Public ' +
  `License, version 3. Source code: ${SWARM_SOURCE_CODE_URL}. It is built ` +
  'on open-source software, including Signal Desktop, © Signal Messenger, ' +
  'LLC (AGPL-3.0), and the components listed below.';

export const LICENCES_TITLE = 'Licences';
export const LICENCE_HEADING = 'GNU Affero General Public License, version 3';
export const ACKNOWLEDGMENTS_HEADING = 'Third-party software';

export type LicencesDocumentInput = Readonly<{
  // package.json build.copyright, the line the installers carry too.
  copyright: string;
  // The repository's LICENSE file: the AGPL-3.0 text.
  licence: string;
  // The repository's ACKNOWLEDGMENTS.md, generated from the dependencies.
  acknowledgments: string;
}>;

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// No script runs in this page (the CSP forbids it and the window disables
// JavaScript); the only styling is inline. It follows the About window: white
// or near-black, with the SWARM orange for links.
const STYLE = `
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    background: #ffffff;
    color: #000000;
    font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  main { max-width: 760px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 16px; margin: 32px 0 8px; }
  a { color: #b35f0d; }
  pre {
    font: 12px/1.45 ui-monospace, 'Cascadia Mono', Menlo, Consolas, monospace;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #121212; color: rgba(255, 255, 255, 0.87); }
    a { color: #ffd08a; }
  }
`;

// Returns the whole page. Every piece of repository text goes through
// escapeHtml, so a licence that contains markup-like text (the AGPL's
// "<https://fsf.org/>", the HTML comments at the top of ACKNOWLEDGMENTS.md)
// is shown as written, never interpreted.
export function buildLicencesDocument({
  copyright,
  licence,
  acknowledgments,
}: LicencesDocumentInput): string {
  const [beforeUrl, afterUrl, ...rest] = LICENCES_INTRODUCTION.split(
    SWARM_SOURCE_CODE_URL
  );
  if (beforeUrl == null || afterUrl == null || rest.length !== 0) {
    throw new Error('LICENCES_INTRODUCTION must name the source URL once');
  }
  if (!copyright.trim() || !licence.trim() || !acknowledgments.trim()) {
    throw new Error(
      'The Licences document needs the copyright line, LICENSE and ' +
        'ACKNOWLEDGMENTS.md; one of them is empty'
    );
  }

  const sourceLink = `<a href="${SWARM_SOURCE_CODE_URL}">${SWARM_SOURCE_CODE_URL}</a>`;

  return [
    '<!doctype html>',
    '<!-- Copyright 2026 SWARM -->',
    '<!-- SPDX-License-Identifier: AGPL-3.0-only -->',
    '<!-- Written by scripts/swarm-generate-licences.mjs from package.json, LICENSE and ACKNOWLEDGMENTS.md. Change those, not this file. -->',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'" />',
    `<title>${escapeHtml(LICENCES_TITLE)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(LICENCES_TITLE)}</h1>`,
    `<p id="introduction">${escapeHtml(beforeUrl)}${sourceLink}${escapeHtml(afterUrl)}</p>`,
    `<p id="copyright">${escapeHtml(copyright.trim())}</p>`,
    '<ul>',
    `<li><a href="#licence">${escapeHtml(LICENCE_HEADING)}</a></li>`,
    `<li><a href="#acknowledgments">${escapeHtml(ACKNOWLEDGMENTS_HEADING)}</a></li>`,
    '</ul>',
    `<h2 id="licence">${escapeHtml(LICENCE_HEADING)}</h2>`,
    `<pre>${escapeHtml(licence)}</pre>`,
    `<h2 id="acknowledgments">${escapeHtml(ACKNOWLEDGMENTS_HEADING)}</h2>`,
    `<pre>${escapeHtml(acknowledgments)}</pre>`,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
