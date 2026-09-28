// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { type ReactElement, useCallback } from 'react';

import type { LocalizerType } from '../../types/Util.std.ts';
import { missingCaseError } from '../../util/missingCaseError.std.ts';
import { openLinkInWebBrowser } from '../../util/openLinkInWebBrowser.dom.ts';
import { Button, ButtonVariant } from '../Button.dom.tsx';
import { TitlebarDragArea } from '../TitlebarDragArea.dom.tsx';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo.dom.tsx';
import { LINK_SIGNAL_DESKTOP } from '../../types/support.std.ts';
import { InstallScreenError } from '../../types/InstallScreen.std.ts';

export type Props = Readonly<{
  error: InstallScreenError;
  i18n: LocalizerType;
  // SWARM addition (M1): when linking fails - and with no server that is the
  // first thing a new user sees - the other half of the first-run choice has to
  // be here too, not only on the QR screen.
  openStandalone: () => unknown;
  quit: () => unknown;
  tryAgain: () => unknown;
}>;

export function InstallScreenErrorStep({
  error,
  i18n,
  openStandalone,
  quit,
  tryAgain,
}: Props): ReactElement {
  let errorMessage: string;
  let buttonText = i18n('icu:installTryAgain');
  let onClickButton = useCallback(() => tryAgain(), [tryAgain]);
  let shouldShowQuitButton = false;

  switch (error) {
    case InstallScreenError.TooManyDevices:
      errorMessage = i18n('icu:installTooManyDevices');
      break;
    case InstallScreenError.TooOld:
      errorMessage = i18n('icu:installTooOld');
      buttonText = i18n('icu:upgrade');
      onClickButton = () => {
        openLinkInWebBrowser('https://swarm.green/download/');
      };
      shouldShowQuitButton = true;
      break;
    case InstallScreenError.ConnectionFailed:
      errorMessage = i18n('icu:installConnectionFailed');
      break;
    case InstallScreenError.QRCodeFailed:
      buttonText = i18n('icu:Install__learn-more');
      errorMessage = i18n('icu:installUnknownError');
      onClickButton = () => {
        openLinkInWebBrowser(LINK_SIGNAL_DESKTOP);
      };
      shouldShowQuitButton = true;
      break;
    default:
      throw missingCaseError(error);
  }

  return (
    <div className="module-InstallScreenErrorStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      <h1>{i18n('icu:installErrorHeader')}</h1>
      <h2>{errorMessage}</h2>

      <div className="module-InstallScreenErrorStep__buttons">
        <Button onClick={onClickButton}>{buttonText}</Button>
        {/* SWARM addition (M1) */}
        <Button
          onClick={() => openStandalone()}
          variant={ButtonVariant.Secondary}
        >
          {i18n('icu:SwarmInstall__create-account-here')}
        </Button>
        {shouldShowQuitButton && (
          <Button onClick={() => quit()} variant={ButtonVariant.Secondary}>
            {i18n('icu:quit')}
          </Button>
        )}
      </div>
    </div>
  );
}
