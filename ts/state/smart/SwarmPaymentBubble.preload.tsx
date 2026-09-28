// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the container of a SWARM payment notice, address
// request or address share in the timeline.
//
// For a notice it asks this app's wallet about the transaction the notice
// names (swarm-wallet:find-transaction), every few seconds until the answer
// cannot change any more, and draws what the wallet says: "waiting for your
// wallet to see it" until the wallet has found it, then "received" with the
// wallet's amount. Asking keeps the wallet syncing, and opens the signed-in
// account's wallet when it is not open, so the notice turns without the Wallet
// pane being opened.
//
// For an address share it says whether the address was kept for this chat
// (the wallet checked it) and, when it was, offers to pay it. For an address
// request it offers Share and Ignore; Share opens the share dialog, where the
// person decides - nothing is shared by the press alone.

import { memo, useCallback, useEffect, useState } from 'react';
import type { JSX, SyntheticEvent } from 'react';
import { useSelector } from 'react-redux';

import { SwarmPaymentBubble } from '../../components/conversation/SwarmPaymentBubble.dom.tsx';
import type {
  SwarmPaymentBubbleOwnProps,
  SwarmShareStatusType,
} from '../../components/conversation/SwarmPaymentBubble.dom.tsx';
import { createLogger } from '../../logging/log.std.ts';
import { ignoreSwarmAddressRequest } from '../../services/swarmChatPayments.preload.ts';
import {
  checkSwarmAddress,
  findSwarmTransaction,
} from '../../services/swarmWallet.preload.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type {
  CheckAddressResultType,
  FindTransactionResultType,
} from '../../types/SwarmWallet.std.ts';
import { drop } from '../../util/drop.std.ts';
import { swarmExplorerFor } from '../../util/swarm/swarmChatPayments.std.ts';
import {
  swarmRequestAnswer,
  theirSwarmAddress,
} from '../../util/swarm/swarmConversation.std.ts';
import {
  bindSwarmNotice,
  isSwarmNoticeSettled,
} from '../../util/swarm/swarmNoticeBinding.std.ts';
import { getConversationSelector } from '../selectors/conversations.dom.ts';
import { getIntl } from '../selectors/user.std.ts';
import { SmartSwarmChatPaymentDialog } from './SwarmChatPayment.preload.tsx';

const log = createLogger('SwarmPaymentBubble');

/** How often a notice asks the wallet again while the answer can change. */
const NOTICE_POLL_MS = 10_000;

// The last answers, so a bubble scrolled away and back shows what it knew
// instead of starting from "waiting" again.
const lookups = new Map<string, FindTransactionResultType>();
const addressChecks = new Map<string, CheckAddressResultType>();

export type RenderSwarmPaymentProps = SwarmPaymentBubbleOwnProps;

export function renderSwarmPayment(
  props: RenderSwarmPaymentProps
): JSX.Element {
  return <SmartSwarmPaymentBubble {...props} />;
}

function stop(event: SyntheticEvent): void {
  event.stopPropagation();
}

const SmartSwarmPaymentBubble = memo(function SmartSwarmPaymentBubble(
  props: RenderSwarmPaymentProps
): JSX.Element {
  const { conversationId, direction, messageId, payment } = props;
  const i18n = useSelector(getIntl);
  const conversation = useSelector(getConversationSelector)(conversationId);
  const [dialog, setDialog] = useState<'share' | 'pay' | null>(null);

  // A notice: what the wallet knows ------------------------------------------------
  const noticeTxid =
    payment.kind === PaymentEventKind.SwarmNotification ? payment.txid : null;
  const noticeMemoHash =
    payment.kind === PaymentEventKind.SwarmNotification
      ? payment.memoHash
      : null;
  const [lookup, setLookup] = useState<FindTransactionResultType | undefined>(
    () => (noticeTxid == null ? undefined : lookups.get(noticeTxid))
  );

  useEffect(() => {
    if (
      noticeTxid == null ||
      payment.kind !== PaymentEventKind.SwarmNotification
    ) {
      return undefined;
    }
    const cached = lookups.get(noticeTxid);
    if (
      cached != null &&
      isSwarmNoticeSettled(bindSwarmNotice(payment, direction, cached))
    ) {
      return undefined;
    }
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const ask = async () => {
      let settled = false;
      try {
        const result = await findSwarmTransaction({
          txid: noticeTxid,
          memoHash: noticeMemoHash,
        });
        lookups.set(noticeTxid, result);
        if (stopped) {
          return;
        }
        setLookup(result);
        settled = isSwarmNoticeSettled(
          bindSwarmNotice(payment, direction, result)
        );
      } catch {
        log.warn('could not ask the wallet about a payment notice');
      }
      if (!stopped && !settled) {
        timer = setTimeout(() => drop(ask()), NOTICE_POLL_MS);
      }
    };
    timer = setTimeout(() => drop(ask()), 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [direction, noticeMemoHash, noticeTxid, payment]);

  // An address share: was it kept? ---------------------------------------------------
  const kept = theirSwarmAddress(conversation.swarmPayments, payment.chain);
  const sharedAddress =
    payment.kind === PaymentEventKind.SwarmAddressShare
      ? payment.address
      : null;
  const [addressCheck, setAddressCheck] = useState<
    CheckAddressResultType | undefined
  >(() =>
    sharedAddress == null ? undefined : addressChecks.get(sharedAddress)
  );
  const isKept = kept?.messageId === messageId;

  useEffect(() => {
    if (
      sharedAddress == null ||
      direction !== 'incoming' ||
      isKept ||
      addressChecks.has(sharedAddress)
    ) {
      return;
    }
    let stopped = false;
    drop(
      (async () => {
        try {
          const result = await checkSwarmAddress(sharedAddress);
          addressChecks.set(sharedAddress, result);
          if (!stopped) {
            setAddressCheck(result);
          }
        } catch {
          log.warn('could not check a shared address');
        }
      })()
    );
    return () => {
      stopped = true;
    };
  }, [direction, isKept, sharedAddress]);

  let shareStatus: SwarmShareStatusType | undefined;
  if (sharedAddress != null && direction === 'incoming') {
    if (isKept) {
      shareStatus = { kind: 'kept' };
    } else if (addressCheck == null) {
      shareStatus = { kind: 'checking' };
    } else if (!addressCheck.accepted) {
      shareStatus = {
        kind: 'refused',
        reason:
          addressCheck.detail ??
          i18n('icu:SwarmWallet__refusal--invalid-address'),
      };
    } else if (addressCheck.chain !== payment.chain) {
      shareStatus = {
        kind: 'refused',
        reason: i18n('icu:SwarmWallet__refusal--invalid-address'),
      };
    } else if (kept != null) {
      shareStatus = { kind: 'replaced' };
    }
  }

  // An address request: answered? ---------------------------------------------------
  const requestAnswer =
    payment.kind === PaymentEventKind.SwarmAddressRequest
      ? swarmRequestAnswer(conversation.swarmPayments, payment.chain, messageId)
      : undefined;

  const onIgnore = useCallback(() => {
    drop(
      ignoreSwarmAddressRequest(conversationId, {
        messageId,
        chain: payment.chain,
      })
    );
  }, [conversationId, messageId, payment.chain]);

  const noticeView =
    payment.kind === PaymentEventKind.SwarmNotification
      ? bindSwarmNotice(payment, direction, lookup)
      : undefined;

  return (
    <>
      <SwarmPaymentBubble
        {...props}
        i18n={i18n}
        explorer={swarmExplorerFor(payment.chain)}
        noticeView={noticeView}
        shareStatus={shareStatus}
        requestAnswer={requestAnswer}
        returnAddressKept={
          payment.kind === PaymentEventKind.SwarmNotification && isKept
        }
        onShare={() => setDialog('share')}
        onIgnore={onIgnore}
        onPay={() => setDialog('pay')}
      />
      {dialog != null ? (
        // The dialog is drawn in a portal, but its events still travel up
        // the React tree; the message around it must not act on them.
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={stop}
          onKeyUp={stop}
          onMouseDown={stop}
          onPointerDown={stop}
          onContextMenu={stop}
        >
          <SmartSwarmChatPaymentDialog
            conversationId={conversationId}
            mode={dialog}
            answeringMessageId={dialog === 'share' ? messageId : undefined}
            onClose={() => setDialog(null)}
          />
        </div>
      ) : null}
    </>
  );
});
