// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the container of the chat's SWARM dialog (pay,
// share an address, ask for one). It reads the wallet state while the dialog
// is open, the conversation's address from the conversation, and turns the
// dialog's intentions into the wallet's IPC calls and the chat's messages.
//
// Paying uses the wallet's own quote and confirm channels - the same two the
// Wallet pane uses - and the notice is sent only from the wallet's answer to
// the confirm (txid, chain, memo hash), never before it.

import { memo, useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useSelector } from 'react-redux';

import { SwarmChatPaymentDialog } from '../../components/SwarmChatPaymentDialog.dom.tsx';
import type {
  SwarmChatDialogModeType,
  SwarmChatShareProblemType,
} from '../../components/SwarmChatPaymentDialog.dom.tsx';
import type { SwarmSentType } from '../../components/SwarmSendFlow.dom.tsx';
import { createLogger } from '../../logging/log.std.ts';
import {
  requestSwarmAddress,
  sendSwarmPaymentNotice,
  shareSwarmAddress,
} from '../../services/swarmChatPayments.preload.ts';
import {
  cancelSwarmWalletSend,
  confirmSwarmWalletSend,
  getSwarmWalletState,
  quoteSwarmWalletSend,
} from '../../services/swarmWallet.preload.ts';
import type { SwarmWalletStateType } from '../../types/SwarmWallet.std.ts';
import { drop } from '../../util/drop.std.ts';
import { formatDateTimeLong } from '../../util/formatTimestamp.dom.ts';
import { isSwarmChainLabel } from '../../util/swarm/swarmChatPayments.std.ts';
import { theirSwarmAddress } from '../../util/swarm/swarmConversation.std.ts';
import { getSwarmWalletChain } from '../../util/swarm/swarmWalletChain.dom.ts';
import { getConversationSelector } from '../selectors/conversations.dom.ts';
import { getIntl } from '../selectors/user.std.ts';

const log = createLogger('SwarmChatPayment');

/** How often the dialog asks for the wallet's state while it is open. */
const POLL_MS = 3000;

export type SmartSwarmChatPaymentDialogProps = Readonly<{
  conversationId: string;
  mode: SwarmChatDialogModeType;
  /** When sharing answers an address request: that request's message. */
  answeringMessageId?: string;
  onClose: () => void;
}>;

export const SmartSwarmChatPaymentDialog = memo(
  function SmartSwarmChatPaymentDialog({
    conversationId,
    mode,
    answeringMessageId,
    onClose,
  }: SmartSwarmChatPaymentDialogProps): JSX.Element {
    const i18n = useSelector(getIntl);
    const conversation = useSelector(getConversationSelector)(conversationId);
    const [wallet, setWallet] = useState<SwarmWalletStateType | undefined>();

    useEffect(() => {
      let stopped = false;
      const load = async () => {
        try {
          const state = await getSwarmWalletState();
          if (!stopped) {
            setWallet(state);
          }
        } catch {
          log.warn('could not read the wallet state');
        }
      };
      const first = setTimeout(() => drop(load()), 0);
      const timer = setInterval(() => drop(load()), POLL_MS);
      return () => {
        stopped = true;
        clearTimeout(first);
        clearInterval(timer);
      };
    }, []);

    const chain =
      wallet != null && isSwarmChainLabel(wallet.network.chain)
        ? wallet.network.chain
        : getSwarmWalletChain();
    const kept = theirSwarmAddress(conversation.swarmPayments, chain);
    const theirAddress =
      kept == null
        ? undefined
        : {
            address: kept.address,
            origin: i18n('icu:SwarmChat__pay--origin', {
              name: conversation.title,
              date: formatDateTimeLong(i18n, kept.sentAt),
            }),
          };

    const onSent = useCallback(
      async (
        { quote, result }: SwarmSentType,
        { includeMyAddress }: { includeMyAddress: boolean }
      ): Promise<boolean> => {
        // The wallet makes one transaction for a payment to a shielded
        // address; when it made more (a two-step payment), the last is the
        // one that pays the recipient.
        const txid = result.txids.at(-1);
        if (txid == null) {
          return false;
        }
        try {
          await sendSwarmPaymentNotice(conversationId, {
            txid,
            amountZat: quote.amountZat,
            memoHash: result.memoHash,
            chain: result.chain,
            includeMyAddress,
          });
          return true;
        } catch (error) {
          // The payment has happened; only the notice is lost.
          log.warn(
            `the payment notice could not be queued (${error instanceof Error ? error.name : 'error'})`
          );
          return false;
        }
      },
      [conversationId]
    );

    const onShare = useCallback(
      async ({
        perConversation,
      }: {
        perConversation: boolean;
      }): Promise<SwarmChatShareProblemType | null> => {
        const result = await shareSwarmAddress(conversationId, {
          perConversation,
          answeringMessageId,
        });
        return result.ok ? null : result.problem;
      },
      [answeringMessageId, conversationId]
    );

    const onRequest = useCallback(async () => {
      try {
        await requestSwarmAddress(conversationId);
      } catch (error) {
        log.warn(
          `the address request could not be queued (${error instanceof Error ? error.name : 'error'})`
        );
      }
    }, [conversationId]);

    const onCancelQuote = useCallback(() => {
      drop(cancelSwarmWalletSend());
    }, []);

    return (
      <SwarmChatPaymentDialog
        i18n={i18n}
        mode={mode}
        contactName={conversation.title}
        wallet={wallet}
        theirAddress={theirAddress}
        onQuote={quoteSwarmWalletSend}
        onConfirm={confirmSwarmWalletSend}
        onCancelQuote={onCancelQuote}
        onSent={onSent}
        onShare={onShare}
        onRequest={onRequest}
        onClose={onClose}
      />
    );
  }
);

/** For the composer: renders the dialog for one conversation. */
export function renderSwarmChatPaymentDialog(
  props: SmartSwarmChatPaymentDialogProps
): JSX.Element {
  return <SmartSwarmChatPaymentDialog {...props} />;
}
