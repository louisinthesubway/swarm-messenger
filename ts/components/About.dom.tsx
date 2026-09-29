// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import { useEscapeHandling } from '../hooks/useEscapeHandling.dom.ts';

export type AboutProps = Readonly<{
  closeAbout: () => unknown;
  appEnv: string;
  arch: string;
  platform: string;
  i18n: LocalizerType;
  showLicences: () => unknown;
  version: string;
}>;

export function About({
  closeAbout,
  appEnv,
  arch,
  platform,
  i18n,
  showLicences,
  version,
}: AboutProps): JSX.Element {
  useEscapeHandling(closeAbout);

  let env: string;

  if (platform === 'darwin') {
    if (arch === 'arm64') {
      env = i18n('icu:About__AppEnvironment--AppleSilicon', { appEnv });
    } else {
      env = i18n('icu:About__AppEnvironment--AppleIntel', { appEnv });
    }
  } else {
    env = i18n('icu:About__AppEnvironment', { appEnv });
  }

  return (
    <div className="About">
      <div className="module-splash-screen">
        <div className="module-splash-screen__logo module-splash-screen__logo--128" />

        <h1 className="About__Title">{i18n('icu:signalDesktop')}</h1>
        <div className="About__Body version">{version}</div>
        <div className="About__Body environment">{env}</div>
        <br />
        <div>
          <a href="https://swarm.green">swarm.green</a>
        </div>
        <br />
        {/*
          SWARM change (B2c): the licence notices are not written out here.
          "Licences" opens the Licences document shipped inside the app
          (build/licences.html): the licence paragraph with the offer of the
          source code, the AGPL-3.0 text and the third-party notices. It
          replaces the acknowledgments link, which pointed at GitHub.
        */}
        <div>
          <button
            type="button"
            className="About__Licences"
            onClick={() => showLicences()}
          >
            {i18n('icu:About__Licences')}
          </button>
        </div>
        <div>
          <a className="privacy" href="https://swarm.green/legal">
            {i18n('icu:privacyPolicy')}
          </a>
        </div>
      </div>
    </div>
  );
}
