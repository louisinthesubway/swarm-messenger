// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M1 mount point, M3 wave 1 wallet): the container for the
// Wallet pane. It asks the wallet service for its state while the pane is on
// screen - a few seconds apart, never blocking anything - and turns the pane's
// callbacks into IPC calls. The wallet itself is in the main process.

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useSelector } from 'react-redux';

import { SwarmWalletPane } from '../../components/SwarmWalletPane.dom.tsx';
import type { SwarmTransactionLabelType } from '../../components/SwarmWalletPane.dom.tsx';
import { isSwarmChainLabel } from '../../util/swarm/swarmChatPayments.std.ts';
import { getIntl } from '../selectors/user.std.ts';
import { createLogger } from '../../logging/log.std.ts';
import * as Errors from '../../types/errors.std.ts';
import { drop } from '../../util/drop.std.ts';
import {
  cancelSwarmWalletSend,
  confirmSwarmWalletSend,
  getSwarmWalletState,
  openSwarmWalletWithPhrase,
  quoteSwarmWalletSend,
  refreshSwarmWallet,
  revealSwarmRecoveryPhrase,
  setSwarmWalletNetwork,
} from '../../services/swarmWallet.preload.ts';
import type {
  SwarmWalletNetworkIdType,
  SwarmWalletProblemType,
  SwarmWalletStateType,
} from '../../types/SwarmWallet.std.ts';

const log = createLogger('SwarmWalletTab');

/**
 * SWARM addition (M3 wave 2): who each listed transaction was with, when a
 * payment notice in a chat named it. From the conversations' own records, on
 * this device.
 */
function transactionLabels(
  state: SwarmWalletStateType | undefined
): Record<string, SwarmTransactionLabelType> {
  const labels: Record<string, SwarmTransactionLabelType> = {};
  if (state == null || state.transactions.length === 0) {
    return labels;
  }
  const { chain } = state.network;
  if (!isSwarmChainLabel(chain)) {
    return labels;
  }
  const listed = new Set(state.transactions.map(({ txid }) => txid));
  for (const conversation of window.ConversationController.getAll()) {
    const notices = conversation.get('swarmPayments')?.[chain]?.notices;
    if (notices == null) {
      continue;
    }
    for (const notice of notices) {
      if (listed.has(notice.txid)) {
        labels[notice.txid] = {
          title: conversation.getTitle(),
          direction: notice.direction,
        };
      }
    }
  }
  return labels;
}

/** How often the pane asks for fresh state while it is shown. */
const POLL_MS = 3000;

export const SmartSwarmWalletTab = memo(
  function SmartSwarmWalletTab(): JSX.Element {
    const i18n = useSelector(getIntl);
    const [state, setState] = useState<SwarmWalletStateType | undefined>();

    const load = useCallback(async () => {
      try {
        setState(await getSwarmWalletState());
      } catch (error) {
        // Categories only: no address, no amount.
        log.warn('could not read the wallet state', Errors.toLogFormat(error));
      }
    }, []);

    useEffect(() => {
      // The first answer as soon as possible, then every few seconds; both
      // from timers, so no state is set while the effect itself runs.
      const first = setTimeout(() => drop(load()), 0);
      const timer = setInterval(() => drop(load()), POLL_MS);
      return () => {
        clearTimeout(first);
        clearInterval(timer);
      };
    }, [load]);

    const onRestore = useCallback(
      async (phrase: string): Promise<SwarmWalletProblemType | null> => {
        const result = await openSwarmWalletWithPhrase({
          phrase,
          isNewPhrase: false,
          forSignedInAccount: true,
        });
        if (!result.ok) {
          return result.problem;
        }
        setState(result.state);
        return null;
      },
      []
    );

    const onRetry = useCallback(() => {
      drop(
        (async () => {
          try {
            setState(await refreshSwarmWallet());
          } catch (error) {
            log.warn('refresh failed', Errors.toLogFormat(error));
          }
        })()
      );
    }, []);

    const onSetNetwork = useCallback((network: SwarmWalletNetworkIdType) => {
      drop(
        (async () => {
          try {
            setState(await setSwarmWalletNetwork(network));
          } catch (error) {
            log.warn('network switch failed', Errors.toLogFormat(error));
          }
        })()
      );
    }, []);

    const onCancelQuote = useCallback(() => {
      drop(cancelSwarmWalletSend());
    }, []);

    const onCopyAddress = useCallback((address: string) => {
      drop(navigator.clipboard.writeText(address));
    }, []);

    const labels = useMemo(() => transactionLabels(state), [state]);

    return (
      <SwarmWalletPane
        i18n={i18n}
        state={state}
        onRestore={onRestore}
        onRetry={onRetry}
        onQuote={quoteSwarmWalletSend}
        onConfirm={confirmSwarmWalletSend}
        onCancelQuote={onCancelQuote}
        onSetNetwork={onSetNetwork}
        onCopyAddress={onCopyAddress}
        transactionLabels={labels}
        // SWARM addition (B6, 2026-09-29): "Recovery phrase".
        onRevealRecoveryPhrase={revealSwarmRecoveryPhrase}
      />
    );
  }
);
