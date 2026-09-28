// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the content of a SWARM payment notice, address
// request or address share, inside the message bubble.
//
// Presentational. What it says about money comes from `noticeView`, which is
// bound to the wallet (ts/util/swarm/swarmNoticeBinding.std.ts): a received
// notice says "X SWM sent to you - waiting for your wallet to see it" until
// the wallet has found the transaction, and only then "Received", with the
// wallet's amount.

import type { JSX, ReactNode } from 'react';

import { tw } from '../../axo/tw.dom.tsx';
import { AxoButton } from '../../axo/AxoButton.dom.tsx';
import { getPaymentEventDescription } from '../../messages/payments.std.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type {
  SwarmAddressShareEvent,
  SwarmPaymentEvent,
  SwarmPaymentNotificationEvent,
} from '../../types/Payment.std.ts';
import { explorerTransactionUrl } from '../../types/SwarmWallet.std.ts';
import type { MemoVerdictType } from '../../types/SwarmWallet.std.ts';
import type { LocalizerType } from '../../types/Util.std.ts';
import {
  formatZatoshiAsSwm,
  zatoshiFromString,
} from '../../util/swarm/swmAmount.std.ts';
import type { SwarmNoticeViewType } from '../../util/swarm/swarmNoticeBinding.std.ts';
import type { SwarmRequestAnswerType } from '../../util/swarm/swarmConversation.std.ts';

/** What the message itself knows; the smart container adds the rest. */
export type SwarmPaymentBubbleOwnProps = Readonly<{
  messageId: string;
  conversationId: string;
  direction: 'incoming' | 'outgoing';
  payment: SwarmPaymentEvent;
  senderTitle: string;
  conversationTitle: string;
  senderIsMe: boolean;
}>;

export type SwarmShareStatusType =
  | Readonly<{ kind: 'checking' }>
  /** Kept against this conversation: the address "Pay" uses. */
  | Readonly<{ kind: 'kept' }>
  /** A later address from the same person is kept instead. */
  | Readonly<{ kind: 'replaced' }>
  /** The wallet refused it; its sentence names the network. */
  | Readonly<{ kind: 'refused'; reason: string }>;

export type SwarmPaymentBubbleProps = SwarmPaymentBubbleOwnProps &
  Readonly<{
    i18n: LocalizerType;
    /** The network's explorer, ending in a slash, when the wallet said it. */
    explorer?: string;
    /** For a notice: what the wallet knows. Undefined before it answered. */
    noticeView?: SwarmNoticeViewType;
    /** For a received share. */
    shareStatus?: SwarmShareStatusType;
    /** For a received request: how it was answered here. */
    requestAnswer?: SwarmRequestAnswerType;
    /** A notice's return address was kept for this conversation. */
    returnAddressKept?: boolean;
    onShare?: () => void;
    onIgnore?: () => void;
    onPay?: () => void;
  }>;

function Line({
  children,
  testId,
  tone = 'secondary',
}: {
  children: ReactNode;
  testId?: string;
  tone?: 'primary' | 'secondary' | 'destructive';
}): JSX.Element {
  let color: string;
  if (tone === 'primary') {
    color = tw('text-primary');
  } else if (tone === 'destructive') {
    color = tw('text-destructive');
  } else {
    color = tw('text-secondary');
  }
  return (
    <p
      data-testid={testId}
      className={tw('type-body-small wrap-break-word', color)}
    >
      {children}
    </p>
  );
}

function swm(zatoshi: string): string {
  return formatZatoshiAsSwm(zatoshiFromString(zatoshi));
}

export function SwarmPaymentBubble(
  props: SwarmPaymentBubbleProps
): JSX.Element {
  const { payment } = props;
  return (
    <div
      data-testid="SwarmPaymentBubble"
      data-kind={payment.kind}
      className={tw('flex max-w-80 flex-col gap-1 px-3 pt-2 pb-1')}
    >
      {payment.kind === PaymentEventKind.SwarmNotification ? (
        <Notice {...props} payment={payment} />
      ) : null}
      {payment.kind === PaymentEventKind.SwarmAddressRequest ? (
        <Request {...props} />
      ) : null}
      {payment.kind === PaymentEventKind.SwarmAddressShare ? (
        <Share {...props} payment={payment} />
      ) : null}
    </div>
  );
}

function description(props: SwarmPaymentBubbleProps): string {
  return getPaymentEventDescription(
    props.payment,
    props.senderTitle,
    props.conversationTitle,
    props.senderIsMe,
    props.i18n
  );
}

// A payment notice -----------------------------------------------------------------

function Notice(
  props: SwarmPaymentBubbleProps & { payment: SwarmPaymentNotificationEvent }
): JSX.Element {
  const { i18n, payment, noticeView, explorer, direction } = props;
  const view: SwarmNoticeViewType =
    noticeView ??
    (direction === 'incoming'
      ? { state: 'waiting', claimedZat: payment.amountZat, walletClosed: false }
      : { state: 'sent-unlisted' });

  return (
    <>
      <p className={tw('type-body-small font-semibold text-primary')}>
        {i18n('icu:SwarmChat__notice--title')}
      </p>
      {direction === 'outgoing' ? (
        <p className={tw('type-body-medium text-primary')}>
          {description(props)}
        </p>
      ) : null}
      <NoticeState i18n={i18n} view={view} />
      {payment.note != null ? <Line tone="primary">{payment.note}</Line> : null}
      {direction === 'incoming' && props.returnAddressKept === true ? (
        <Line testId="return-address">
          {i18n('icu:SwarmChat__notice--return-address', {
            name: props.senderTitle,
          })}
        </Line>
      ) : null}
      {explorer != null ? (
        <a
          data-testid="notice-explorer"
          className={tw('type-body-small text-accent underline')}
          href={explorerTransactionUrl(explorer, payment.txid)}
          target="_blank"
          rel="noreferrer"
        >
          <span className={tw('font-swarm-mono')}>
            {`${payment.txid.slice(0, 10)}…${payment.txid.slice(-6)}`}
          </span>{' '}
          {i18n('icu:SwarmChat__notice--explorer')}
        </a>
      ) : null}
    </>
  );
}

function NoticeState({
  i18n,
  view,
}: {
  i18n: LocalizerType;
  view: SwarmNoticeViewType;
}): JSX.Element {
  switch (view.state) {
    case 'waiting':
      return (
        <>
          <p
            data-testid="notice-waiting"
            className={tw('type-body-medium text-primary')}
          >
            {i18n('icu:SwarmChat__notice--waiting', {
              amount: swm(view.claimedZat),
            })}
          </p>
          {view.walletClosed ? (
            <Line>{i18n('icu:SwarmChat__notice--wallet-closed')}</Line>
          ) : null}
        </>
      );
    case 'seen':
      return (
        <>
          <p
            data-testid="notice-seen"
            className={tw('type-body-medium text-primary')}
          >
            {i18n('icu:SwarmChat__notice--seen', {
              amount: swm(view.walletZat),
            })}
          </p>
          <Memo i18n={i18n} verdict={view.memo} text={view.memoText} />
        </>
      );
    case 'received':
      return (
        <>
          <p
            data-testid="notice-received"
            className={tw('type-body-medium font-semibold text-primary')}
          >
            {i18n('icu:SwarmChat__notice--received', {
              amount: swm(view.walletZat),
            })}
          </p>
          {view.blockHeight != null ? (
            <Line>
              {i18n('icu:SwarmChat__notice--block', {
                height: view.blockHeight,
              })}
            </Line>
          ) : null}
          {view.claimedZat != null ? (
            <Line testId="notice-amount-differs" tone="destructive">
              {i18n('icu:SwarmChat__notice--amount-differs', {
                claimed: swm(view.claimedZat),
              })}
            </Line>
          ) : null}
          <Memo i18n={i18n} verdict={view.memo} text={view.memoText} />
        </>
      );
    case 'not-to-you':
      return (
        <p
          data-testid="notice-not-to-you"
          className={tw('type-body-medium text-destructive')}
        >
          {i18n('icu:SwarmChat__notice--not-to-you')}
        </p>
      );
    case 'sent-unlisted':
      return <Line>{i18n('icu:SwarmChat__notice--sent-unlisted')}</Line>;
    case 'sent-waiting':
      return <Line>{i18n('icu:SwarmChat__notice--sent-waiting')}</Line>;
    case 'sent-confirmed':
      return view.blockHeight == null ? (
        <Line>{i18n('icu:SwarmChat__notice--sent-waiting')}</Line>
      ) : (
        <Line testId="notice-sent-confirmed">
          {i18n('icu:SwarmChat__notice--block', { height: view.blockHeight })}
        </Line>
      );
    case 'sent-failed':
      return (
        <Line tone="destructive">
          {i18n('icu:SwarmChat__notice--sent-failed')}
        </Line>
      );
    default:
      return <Line>{i18n('icu:SwarmChat__notice--sent-unlisted')}</Line>;
  }
}

function Memo({
  i18n,
  verdict,
  text,
}: {
  i18n: LocalizerType;
  verdict: MemoVerdictType;
  text: string | null;
}): JSX.Element | null {
  return (
    <>
      {text != null ? (
        <Line tone="primary">
          {i18n('icu:SwarmChat__notice--memo', { memo: text })}
        </Line>
      ) : null}
      {verdict === 'mismatch' ? (
        <Line testId="notice-memo-mismatch" tone="destructive">
          {i18n('icu:SwarmChat__notice--memo-mismatch')}
        </Line>
      ) : null}
    </>
  );
}

// An address request ---------------------------------------------------------------

function Request(props: SwarmPaymentBubbleProps): JSX.Element {
  const { i18n, direction, requestAnswer, onShare, onIgnore } = props;
  return (
    <>
      <p className={tw('type-body-medium text-primary')}>
        {description(props)}
      </p>
      {direction === 'incoming' && requestAnswer === 'shared' ? (
        <Line>{i18n('icu:SwarmChat__request--answered-shared')}</Line>
      ) : null}
      {direction === 'incoming' && requestAnswer === 'ignored' ? (
        <Line>{i18n('icu:SwarmChat__request--answered-ignored')}</Line>
      ) : null}
      {direction === 'incoming' &&
      requestAnswer == null &&
      onShare != null &&
      onIgnore != null ? (
        <div className={tw('flex flex-wrap gap-2 py-1')}>
          <AxoButton.Root variant="strong-primary" size="sm" onClick={onShare}>
            {i18n('icu:SwarmChat__request--answer-share')}
          </AxoButton.Root>
          <AxoButton.Root
            variant="subtle-secondary"
            size="sm"
            onClick={onIgnore}
          >
            {i18n('icu:SwarmChat__request--answer-ignore')}
          </AxoButton.Root>
        </div>
      ) : null}
    </>
  );
}

// An address share -----------------------------------------------------------------

function Share(
  props: SwarmPaymentBubbleProps & { payment: SwarmAddressShareEvent }
): JSX.Element {
  const { i18n, payment, direction, shareStatus, onPay, senderTitle } = props;
  return (
    <>
      <p className={tw('type-body-medium text-primary')}>
        {description(props)}
      </p>
      <p className={tw('type-body-small text-secondary')}>
        {i18n('icu:SwarmChat__address-label')}
      </p>
      <code
        data-testid="shared-address"
        className={tw(
          'font-swarm-mono type-body-small break-all text-primary select-text'
        )}
      >
        {payment.address}
      </code>
      {direction === 'incoming' && shareStatus?.kind === 'checking' ? (
        <Line>{i18n('icu:SwarmChat__share--checking')}</Line>
      ) : null}
      {direction === 'incoming' && shareStatus?.kind === 'kept' ? (
        <Line testId="share-kept">
          {i18n('icu:SwarmChat__share--kept', { name: senderTitle })}
        </Line>
      ) : null}
      {direction === 'incoming' && shareStatus?.kind === 'replaced' ? (
        <Line>
          {i18n('icu:SwarmChat__share--replaced', { name: senderTitle })}
        </Line>
      ) : null}
      {direction === 'incoming' && shareStatus?.kind === 'refused' ? (
        <Line testId="share-refused" tone="destructive">
          {i18n('icu:SwarmChat__share--refused', {
            reason: shareStatus.reason,
          })}
        </Line>
      ) : null}
      {direction === 'incoming' &&
      shareStatus?.kind === 'kept' &&
      onPay != null ? (
        <div className={tw('py-1')}>
          <AxoButton.Root variant="strong-primary" size="sm" onClick={onPay}>
            {i18n('icu:SwarmChat__share--pay', { name: senderTitle })}
          </AxoButton.Root>
        </div>
      ) : null}
    </>
  );
}
