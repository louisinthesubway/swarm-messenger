// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the dialog a chat opens for SWARM - to pay, to
// share an address, or to ask for one. Presentational: the wallet state, the
// conversation's address and every action come in as props.
//
// Paying is the Wallet pane's own send flow (SwarmSendFlow), addressed to the
// address this conversation holds and showing which message it came from.
// Only after the wallet has returned the txid is the other person told
// (onSent); the choice to include one's own address for paying back is off
// until ticked.

import { useCallback, useId, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { AxoCheckbox } from '../axo/AxoCheckbox.dom.tsx';
import { AxoDialog } from '../axo/AxoDialog.dom.tsx';
import { Amount, SwarmSendFlow } from './SwarmSendFlow.dom.tsx';
import type { SwarmSentType } from './SwarmSendFlow.dom.tsx';
import { zatoshiFromString } from '../util/swarm/swmAmount.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import type {
  ConfirmSendResultType,
  QuoteSendResultType,
  SwarmWalletStateType,
} from '../types/SwarmWallet.std.ts';

export type SwarmChatDialogModeType = 'pay' | 'share' | 'request';

export type SwarmChatShareProblemType = 'not-ready' | 'offline' | 'rejected';

export type SwarmChatPaymentDialogProps = Readonly<{
  i18n: LocalizerType;
  mode: SwarmChatDialogModeType;
  /** The other person, as the chat names them. */
  contactName: string;
  /** Undefined until the wallet has answered. */
  wallet: SwarmWalletStateType | undefined;
  /**
   * The address this conversation holds for the wallet's network, checked
   * when it arrived, and a sentence naming the message it came from.
   */
  theirAddress: Readonly<{ address: string; origin: string }> | undefined;
  onQuote: (request: {
    to: string;
    amount: string;
    memo: string;
  }) => Promise<QuoteSendResultType>;
  onConfirm: (quoteId: string) => Promise<ConfirmSendResultType>;
  onCancelQuote: () => void;
  /** Tells the other person; true when the notice was queued. */
  onSent: (
    sent: SwarmSentType,
    options: { includeMyAddress: boolean }
  ) => Promise<boolean>;
  onShare: (options: {
    perConversation: boolean;
  }) => Promise<SwarmChatShareProblemType | null>;
  onRequest: () => Promise<void>;
  onClose: () => void;
}>;

export function SwarmChatPaymentDialog(
  props: SwarmChatPaymentDialogProps
): JSX.Element {
  const { i18n, mode, onClose } = props;
  let title: string;
  if (mode === 'pay') {
    title = i18n('icu:SwarmChat__pay--title');
  } else if (mode === 'share') {
    title = i18n('icu:SwarmChat__share-dialog--title');
  } else {
    title = i18n('icu:SwarmChat__request-dialog--title');
  }

  return (
    <AxoDialog.Root
      open
      onOpenChange={open => {
        if (!open) {
          onClose();
        }
      }}
    >
      <AxoDialog.Content size="md" escape="cancel-is-noop">
        <AxoDialog.Header>
          <AxoDialog.Title>{title}</AxoDialog.Title>
          <AxoDialog.Close />
        </AxoDialog.Header>
        <AxoDialog.Body>
          <SwarmChatPaymentDialogBody {...props} />
        </AxoDialog.Body>
      </AxoDialog.Content>
    </AxoDialog.Root>
  );
}

/** The dialog's content, without the dialog around it (tests render this). */
export function SwarmChatPaymentDialogBody(
  props: SwarmChatPaymentDialogProps
): JSX.Element {
  const { mode } = props;
  return (
    <div
      data-testid="SwarmChatPaymentDialog"
      data-mode={mode}
      className={tw('flex flex-col gap-4 pb-4')}
    >
      {mode === 'pay' ? <PayBody {...props} /> : null}
      {mode === 'share' ? <ShareBody {...props} /> : null}
      {mode === 'request' ? <RequestBody {...props} /> : null}
    </div>
  );
}

function Sentence({
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
    <p data-testid={testId} className={tw('type-body-medium', color)}>
      {children}
    </p>
  );
}

function Buttons({ children }: { children: ReactNode }): JSX.Element {
  return <div className={tw('flex flex-wrap gap-2')}>{children}</div>;
}

/** What to say while the wallet is not ready for this dialog, or null. */
function walletNotice(
  i18n: LocalizerType,
  wallet: SwarmWalletStateType | undefined
): string | null {
  if (wallet == null) {
    return i18n('icu:SwarmChat__dialog--loading');
  }
  if (wallet.status === 'offline') {
    return i18n('icu:SwarmChat__wallet--offline');
  }
  if (wallet.status !== 'ready') {
    return i18n('icu:SwarmChat__wallet--not-ready');
  }
  return null;
}

// Paying --------------------------------------------------------------------------

function PayBody({
  i18n,
  contactName,
  wallet,
  theirAddress,
  onQuote,
  onConfirm,
  onCancelQuote,
  onSent,
  onRequest,
  onClose,
}: SwarmChatPaymentDialogProps): JSX.Element {
  const checkboxId = useId();
  const [includeMyAddress, setIncludeMyAddress] = useState(false);
  const [noticeState, setNoticeState] = useState<
    'none' | 'sending' | 'sent' | 'failed'
  >('none');
  const [requesting, setRequesting] = useState(false);

  const handleSent = useCallback(
    (sent: SwarmSentType) => {
      setNoticeState('sending');
      void (async () => {
        let ok = false;
        try {
          ok = await onSent(sent, { includeMyAddress });
        } catch {
          ok = false;
        }
        setNoticeState(ok ? 'sent' : 'failed');
      })();
    },
    [includeMyAddress, onSent]
  );

  const notice = walletNotice(i18n, wallet);
  if (notice != null || wallet == null) {
    return (
      <>
        <Sentence testId="wallet-notice">{notice}</Sentence>
        <Buttons>
          <AxoButton.Root
            variant="subtle-secondary"
            size="md"
            onClick={onClose}
          >
            {i18n('icu:cancel')}
          </AxoButton.Root>
        </Buttons>
      </>
    );
  }

  if (theirAddress == null) {
    return (
      <>
        <Sentence testId="no-address" tone="primary">
          {i18n('icu:SwarmChat__pay--no-address', { name: contactName })}
        </Sentence>
        <Buttons>
          <AxoButton.Root
            variant="strong-primary"
            size="md"
            pending={requesting}
            onClick={() => {
              if (requesting) {
                return;
              }
              setRequesting(true);
              void (async () => {
                try {
                  await onRequest();
                } catch {
                  // The request is a message; the send queue reports its own
                  // failure in the chat.
                }
                setRequesting(false);
                onClose();
              })();
            }}
          >
            {i18n('icu:SwarmChat__pay--request')}
          </AxoButton.Root>
          <AxoButton.Root
            variant="subtle-secondary"
            size="md"
            onClick={onClose}
          >
            {i18n('icu:cancel')}
          </AxoButton.Root>
        </Buttons>
      </>
    );
  }

  return (
    <>
      {wallet.balance != null ? (
        <p className={tw('type-body-small text-secondary')}>
          {i18n('icu:SwarmWallet__balance--confirmed')}{' '}
          <Amount
            i18n={i18n}
            zatoshi={zatoshiFromString(wallet.balance.confirmedZat)}
          />
        </p>
      ) : null}
      <SwarmSendFlow
        i18n={i18n}
        explorer={wallet.network.explorer}
        fixedTo={{ address: theirAddress.address, origin: theirAddress.origin }}
        formExtras={
          <div className={tw('flex flex-col gap-1')}>
            <div className={tw('flex items-center gap-3')}>
              <AxoCheckbox.Root
                id={checkboxId}
                variant="square"
                checked={includeMyAddress}
                onCheckedChange={setIncludeMyAddress}
              />
              <label
                htmlFor={checkboxId}
                className={tw('type-body-medium text-primary')}
              >
                {i18n('icu:SwarmChat__pay--include-address', {
                  name: contactName,
                })}
              </label>
            </div>
            <p className={tw('type-body-small text-secondary')}>
              {i18n('icu:SwarmChat__pay--include-address-help', {
                name: contactName,
              })}
            </p>
          </div>
        }
        frame={(title, children) => (
          <section className={tw('flex flex-col gap-3')}>
            <h2 className={tw('type-title-small text-primary')}>{title}</h2>
            {children}
            {noticeState === 'sent' ? (
              <Sentence testId="notice-sent">
                {i18n('icu:SwarmChat__pay--notice-sent', { name: contactName })}
              </Sentence>
            ) : null}
            {noticeState === 'failed' ? (
              <Sentence testId="notice-failed" tone="destructive">
                {i18n('icu:SwarmChat__pay--notice-failed', {
                  name: contactName,
                })}
              </Sentence>
            ) : null}
          </section>
        )}
        onQuote={onQuote}
        onConfirm={onConfirm}
        onCancelQuote={onCancelQuote}
        onSent={handleSent}
        onDone={onClose}
      />
    </>
  );
}

// Sharing -------------------------------------------------------------------------

function ShareBody({
  i18n,
  contactName,
  wallet,
  onShare,
  onClose,
}: SwarmChatPaymentDialogProps): JSX.Element {
  const checkboxId = useId();
  const [perConversation, setPerConversation] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SwarmChatShareProblemType | null>(
    null
  );

  const notice = walletNotice(i18n, wallet);
  let problemText: string | null = null;
  if (problem === 'offline') {
    problemText = i18n('icu:SwarmChat__wallet--offline');
  } else if (problem === 'not-ready') {
    problemText = i18n('icu:SwarmChat__wallet--not-ready');
  } else if (problem === 'rejected') {
    problemText = i18n('icu:SwarmChat__share-dialog--failed');
  }

  return (
    <>
      <Sentence tone="primary">
        {i18n('icu:SwarmChat__share-dialog--body', { name: contactName })}
      </Sentence>
      <div className={tw('flex flex-col gap-1')}>
        <div className={tw('flex items-center gap-3')}>
          <AxoCheckbox.Root
            id={checkboxId}
            variant="square"
            checked={perConversation}
            onCheckedChange={setPerConversation}
            disabled={busy}
          />
          <label
            htmlFor={checkboxId}
            className={tw('type-body-medium text-primary')}
          >
            {i18n('icu:SwarmChat__share-dialog--fresh')}
          </label>
        </div>
        <p className={tw('type-body-small text-secondary')}>
          {i18n('icu:SwarmChat__share-dialog--fresh-help', {
            name: contactName,
          })}
        </p>
      </div>
      {notice != null ? (
        <Sentence testId="wallet-notice">{notice}</Sentence>
      ) : null}
      {problemText != null ? (
        <Sentence testId="share-problem" tone="destructive">
          {problemText}
        </Sentence>
      ) : null}
      <Buttons>
        <AxoButton.Root
          variant="strong-primary"
          size="md"
          pending={busy}
          disabled={notice != null}
          onClick={() => {
            if (busy) {
              return;
            }
            setBusy(true);
            setProblem(null);
            void (async () => {
              let answer: SwarmChatShareProblemType | null;
              try {
                answer = await onShare({ perConversation });
              } catch {
                answer = 'rejected';
              }
              setBusy(false);
              if (answer == null) {
                onClose();
              } else {
                setProblem(answer);
              }
            })();
          }}
        >
          {i18n('icu:SwarmChat__share-dialog--button')}
        </AxoButton.Root>
        <AxoButton.Root
          variant="subtle-secondary"
          size="md"
          disabled={busy}
          onClick={onClose}
        >
          {i18n('icu:cancel')}
        </AxoButton.Root>
      </Buttons>
    </>
  );
}

// Asking ---------------------------------------------------------------------------

function RequestBody({
  i18n,
  contactName,
  onRequest,
  onClose,
}: SwarmChatPaymentDialogProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Sentence tone="primary">
        {i18n('icu:SwarmChat__request-dialog--body', { name: contactName })}
      </Sentence>
      <Buttons>
        <AxoButton.Root
          variant="strong-primary"
          size="md"
          pending={busy}
          onClick={() => {
            if (busy) {
              return;
            }
            setBusy(true);
            void (async () => {
              try {
                await onRequest();
              } catch {
                // The request is a message; the send queue reports its own
                // failure in the chat.
              }
              setBusy(false);
              onClose();
            })();
          }}
        >
          {i18n('icu:SwarmChat__request-dialog--button')}
        </AxoButton.Root>
        <AxoButton.Root
          variant="subtle-secondary"
          size="md"
          disabled={busy}
          onClick={onClose}
        >
          {i18n('icu:cancel')}
        </AxoButton.Root>
      </Buttons>
    </>
  );
}
