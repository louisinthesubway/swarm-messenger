// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import { useEscapeHandling } from '../hooks/useEscapeHandling.dom.ts';
import { tw } from '../axo/tw.dom.tsx';

export type AboutProps = Readonly<{
  closeAbout: () => unknown;
  appEnv: string;
  arch: string;
  platform: string;
  i18n: LocalizerType;
  version: string;
}>;

export function About({
  closeAbout,
  appEnv,
  arch,
  platform,
  i18n,
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
        <div>
          <a
            className="acknowledgments"
            href="https://github.com/Swarm-Official/swarm-messenger/blob/swarm-main/ACKNOWLEDGMENTS.md"
          >
            {i18n('icu:softwareAcknowledgments')}
          </a>
        </div>
        <div>
          <a className="privacy" href="https://swarm.green/legal">
            {i18n('icu:privacyPolicy')}
          </a>
        </div>
        {/*
          SWARM addition (M1): the AGPL-3.0 attribution. This is the one place
          where Signal is named on purpose, and it must stay.
        */}
        <div className={tw('text-secondary')}>
          {i18n('icu:SwarmAbout__attribution')}
        </div>
      </div>
    </div>
  );
}
