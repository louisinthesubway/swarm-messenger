// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { memo, useCallback, type JSX } from 'react';
import { useSelector } from 'react-redux';
import { KeyTransparencyErrorDialog } from '../../components/KeyTransparencyErrorDialog.dom.tsx';
import { createSupportUrl } from '../../util/createSupportUrl.std.ts';
import { openLinkInWebBrowser } from '../../util/openLinkInWebBrowser.dom.ts';
import { useGlobalModalActions } from '../ducks/globalModals.preload.ts';
import { getIntl } from '../selectors/user.std.ts';

export const SmartKeyTransparencyErrorDialog = memo(
  function SmartKeyTransparencyErrorDialog(): JSX.Element | null {
    const i18n = useSelector(getIntl);
    const { hideKeyTransparencyErrorDialog } = useGlobalModalActions();

    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open) {
          hideKeyTransparencyErrorDialog();
        }
      },
      [hideKeyTransparencyErrorDialog]
    );

    // SWARM change (B5, 2026-09-29): upstream uploaded the debug log to a
    // Signal service and passed the link to the support page. The log now
    // stays on this computer: with the box ticked, the debug log window opens
    // (in 'save' mode, so it outlives this dialog) and the user can save the
    // log to a file and attach it themselves. The support page opens as
    // before, without a link.
    const handleSubmit = useCallback(
      (shareDebugLog: boolean) => {
        if (shareDebugLog) {
          window.IPC.showDebugLog({ mode: 'save' });
        }

        const supportURL = createSupportUrl({
          locale: window.SignalContext.getI18nLocale(),
        });

        openLinkInWebBrowser(supportURL);
        hideKeyTransparencyErrorDialog();
      },
      [hideKeyTransparencyErrorDialog]
    );

    return (
      <KeyTransparencyErrorDialog
        i18n={i18n}
        open
        onOpenChange={handleOpenChange}
        onViewDebugLog={() => window.IPC.showDebugLog({ mode: 'close' })}
        onSubmit={handleSubmit}
        isSubmitting={false}
      />
    );
  }
);
