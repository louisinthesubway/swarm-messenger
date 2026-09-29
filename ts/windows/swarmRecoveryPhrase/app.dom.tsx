// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the recovery phrase window's page.

import { createRoot } from 'react-dom/client';

import '../sandboxedInit.dom.ts';
import { SwarmRecoveryPhraseWindow } from '../../components/SwarmRecoveryPhraseWindow.dom.tsx';
import { strictAssert } from '../../util/assert.std.ts';
import { AppProvider } from '../AppProvider.dom.tsx';
import { setDocumentLocale } from '../../util/setDocumentLocale.dom.ts';

const { SwarmRecoveryPhraseWindowProps } = window.Signal;
const { i18n } = window.SignalContext;

setDocumentLocale(document);

strictAssert(SwarmRecoveryPhraseWindowProps, 'window values not provided');

const app = document.getElementById('app');
strictAssert(app != null, 'No #app');

createRoot(app).render(
  <AppProvider>
    <SwarmRecoveryPhraseWindow
      i18n={i18n}
      getStatus={SwarmRecoveryPhraseWindowProps.getStatus}
      onReveal={SwarmRecoveryPhraseWindowProps.reveal}
      onCopy={SwarmRecoveryPhraseWindowProps.copy}
      onSave={SwarmRecoveryPhraseWindowProps.save}
      onClose={SwarmRecoveryPhraseWindowProps.close}
    />
  </AppProvider>
);
