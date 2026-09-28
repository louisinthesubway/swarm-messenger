// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the one way this app sends SWM, used by the Wallet
// pane and by "Pay with SWARM" in a chat alike. Moved here unchanged from the
// pane (M3 wave 1) so that a chat payment is not a second send path: the same
// form, the same quote -> confirmation -> send steps, the same refusals, over
// the same two IPC channels (quote-send, confirm-send).
//
// Sending takes two deliberate steps: "Review payment" asks the wallet for a
// quote (nothing moves), and only the button on the confirmation screen, which
// names the address, the amount, the fee and the total, sends.
//
// In a chat the address is not typed: it is the one the conversation holds,
// shown with the message it came from, so a swapped address is visible.

import { useCallback, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import {
  formatZatoshiAsSwm,
  parseSwmAmount,
  zatoshiFromString,
} from '../util/swarm/swmAmount.std.ts';
import { explorerTransactionUrl } from '../types/SwarmWallet.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import type {
  ConfirmSendResultType,
  QuoteSendResultType,
  SendQuoteType,
  SendRefusalType,
} from '../types/SwarmWallet.std.ts';

export type SwarmSentType = Readonly<{
  quote: SendQuoteType;
  result: Extract<ConfirmSendResultType, { ok: true }>;
}>;

export type SwarmSendFlowProps = Readonly<{
  i18n: LocalizerType;
  /** The network's block explorer, ending in a slash. */
  explorer: string;
  /**
   * In a chat: the address is the conversation's, not typed, and `origin`
   * says which message it came from.
   */
  fixedTo?: Readonly<{ address: string; origin: ReactNode }>;
  /** Shown in the form above "Review payment" (the chat's own choices). */
  formExtras?: ReactNode;
  /** Draws one step: a titled card in the pane, a section in a dialog. */
  frame: (title: string, children: ReactNode) => JSX.Element;
  onQuote: (request: {
    to: string;
    amount: string;
    memo: string;
  }) => Promise<QuoteSendResultType>;
  onConfirm: (quoteId: string) => Promise<ConfirmSendResultType>;
  onCancelQuote: () => void;
  /** After the wallet returned the transaction ids, and only then. */
  onSent?: (sent: SwarmSentType) => void;
  /** "Done" on the result screen; without it the form comes back. */
  onDone?: () => void;
}>;

type SendStepType =
  | { step: 'form' }
  | { step: 'quoting' }
  | { step: 'confirm'; quote: SendQuoteType }
  | { step: 'sending'; quote: SendQuoteType }
  | { step: 'sent'; txids: ReadonlyArray<string>; saved: boolean };

export function SwarmSendFlow({
  i18n,
  explorer,
  fixedTo,
  formExtras,
  frame,
  onQuote,
  onConfirm,
  onCancelQuote,
  onSent,
  onDone,
}: SwarmSendFlowProps): JSX.Element {
  const [typedTo, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [step, setStep] = useState<SendStepType>({ step: 'form' });
  const [refusal, setRefusal] = useState<string | null>(null);

  const to = fixedTo?.address ?? typedTo;

  const review = useCallback(async () => {
    setRefusal(null);
    // What can be said without asking the wallet, is said without asking it.
    if (to.trim() === '') {
      setRefusal(i18n('icu:SwarmWallet__refusal--empty-address'));
      return;
    }
    const parsed = parseSwmAmount(amount);
    if (!parsed.ok) {
      setRefusal(amountProblemText(i18n, parsed.problem));
      return;
    }
    setStep({ step: 'quoting' });
    try {
      const result = await onQuote({ to: to.trim(), amount, memo });
      if (result.ok) {
        setStep({ step: 'confirm', quote: result.quote });
      } else {
        setStep({ step: 'form' });
        setRefusal(refusalText(i18n, result.refusal));
      }
    } catch {
      setStep({ step: 'form' });
      setRefusal(i18n('icu:SwarmWallet__refusal--rejected'));
    }
  }, [amount, i18n, memo, onQuote, to]);

  const send = useCallback(
    async (quote: SendQuoteType) => {
      setStep({ step: 'sending', quote });
      try {
        const result = await onConfirm(quote.quoteId);
        if (result.ok) {
          setStep({ step: 'sent', txids: result.txids, saved: result.saved });
          setTo('');
          setAmount('');
          setMemo('');
          onSent?.({ quote, result });
        } else {
          setStep({ step: 'form' });
          setRefusal(refusalText(i18n, result.refusal));
        }
      } catch {
        setStep({ step: 'form' });
        setRefusal(i18n('icu:SwarmWallet__refusal--rejected'));
      }
    },
    [i18n, onConfirm, onSent]
  );

  if (step.step === 'confirm' || step.step === 'sending') {
    const { quote } = step;
    const sending = step.step === 'sending';
    return frame(
      i18n('icu:SwarmWallet__confirm--title'),
      <>
        <dl
          data-testid="send-confirm"
          className={tw('grid grid-cols-[auto_1fr] gap-x-6 gap-y-2')}
        >
          <dt className={tw('type-body-medium text-secondary')}>
            {i18n('icu:SwarmWallet__confirm--to')}
          </dt>
          <dd
            className={tw(
              'font-swarm-mono type-body-small break-all text-primary'
            )}
          >
            {quote.to}
          </dd>
          {fixedTo != null ? (
            <>
              <dt className={tw('sr-only')}>
                {i18n('icu:SwarmChat__pay--origin-label')}
              </dt>
              <dd
                className={tw(
                  'col-span-2 type-body-small wrap-break-word text-secondary'
                )}
              >
                {fixedTo.origin}
              </dd>
            </>
          ) : null}
          <dt className={tw('type-body-medium text-secondary')}>
            {i18n('icu:SwarmWallet__confirm--amount')}
          </dt>
          <dd>
            <Amount i18n={i18n} zatoshi={zatoshiFromString(quote.amountZat)} />
          </dd>
          <dt className={tw('type-body-medium text-secondary')}>
            {i18n('icu:SwarmWallet__confirm--fee')}
          </dt>
          <dd>
            <Amount i18n={i18n} zatoshi={zatoshiFromString(quote.feeZat)} />
          </dd>
          <dt className={tw('type-body-medium text-secondary')}>
            {i18n('icu:SwarmWallet__confirm--total')}
          </dt>
          <dd>
            <Amount i18n={i18n} zatoshi={zatoshiFromString(quote.totalZat)} />
          </dd>
          {quote.memo != null ? (
            <>
              <dt className={tw('type-body-medium text-secondary')}>
                {i18n('icu:SwarmWallet__confirm--memo')}
              </dt>
              <dd
                className={tw('type-body-medium wrap-break-word text-primary')}
              >
                {quote.memo}
              </dd>
            </>
          ) : null}
        </dl>
        <p className={tw('type-body-medium text-primary')}>
          {i18n('icu:SwarmWallet__confirm--warning')}
        </p>
        {sending ? (
          <p className={tw('type-body-small text-secondary')}>
            {i18n('icu:SwarmWallet__sending')}
          </p>
        ) : null}
        <div className={tw('flex flex-wrap gap-2')}>
          <AxoButton.Root
            variant="strong-primary"
            size="md"
            pending={sending}
            onClick={() => {
              if (sending) {
                return;
              }
              void send(quote);
            }}
          >
            {i18n('icu:SwarmWallet__confirm--send', {
              amount: formatZatoshiAsSwm(zatoshiFromString(quote.totalZat)),
            })}
          </AxoButton.Root>
          <AxoButton.Root
            variant="subtle-secondary"
            size="md"
            disabled={sending}
            onClick={() => {
              onCancelQuote();
              setStep({ step: 'form' });
            }}
          >
            {i18n('icu:SwarmWallet__confirm--back')}
          </AxoButton.Root>
        </div>
      </>
    );
  }

  if (step.step === 'sent') {
    return frame(
      i18n('icu:SwarmWallet__sent--title'),
      <div data-testid="send-result" className={tw('flex flex-col gap-2')}>
        {step.txids.map(txid => (
          <div key={txid} className={tw('flex flex-col gap-1')}>
            <code
              className={tw(
                'font-swarm-mono type-body-small break-all text-primary select-text'
              )}
            >
              {i18n('icu:SwarmWallet__sent--txid', { txid })}
            </code>
            <a
              className={tw('type-body-medium text-accent underline')}
              href={explorerTransactionUrl(explorer, txid)}
              target="_blank"
              rel="noreferrer"
            >
              {i18n('icu:SwarmWallet__sent--explorer')}
            </a>
          </div>
        ))}
        {!step.saved ? (
          <p className={tw('type-body-small text-secondary')}>
            {i18n('icu:SwarmWallet__sent--not-saved')}
          </p>
        ) : null}
        <div>
          <AxoButton.Root
            variant="subtle-secondary"
            size="md"
            onClick={() => {
              if (onDone != null) {
                onDone();
                return;
              }
              setStep({ step: 'form' });
            }}
          >
            {i18n('icu:SwarmWallet__sent--done')}
          </AxoButton.Root>
        </div>
      </div>
    );
  }

  const quoting = step.step === 'quoting';
  const fieldClass = tw(
    'w-full rounded-lg border border-primary bg-surface-primary p-2',
    'type-body-medium text-primary'
  );

  return frame(
    i18n('icu:SwarmWallet__send--title'),
    <form
      data-testid="send-form"
      className={tw('flex flex-col gap-3')}
      onSubmit={event => {
        // Nothing is sent from the keyboard: review is a button press.
        event.preventDefault();
      }}
    >
      {fixedTo != null ? (
        <div data-testid="send-fixed-to" className={tw('flex flex-col gap-1')}>
          <span className={tw('type-body-small text-secondary')}>
            {i18n('icu:SwarmWallet__send--to')}
          </span>
          <code
            className={tw(
              'font-swarm-mono type-body-small break-all text-primary select-text'
            )}
          >
            {fixedTo.address}
          </code>
          <span className={tw('type-body-small text-secondary')}>
            {fixedTo.origin}
          </span>
        </div>
      ) : (
        <label className={tw('flex flex-col gap-1')}>
          <span className={tw('type-body-small text-secondary')}>
            {i18n('icu:SwarmWallet__send--to')}
          </span>
          <input
            name="to"
            className={tw(fieldClass, 'font-swarm-mono')}
            disabled={quoting}
            placeholder={i18n('icu:SwarmWallet__send--to-placeholder')}
            spellCheck={false}
            autoComplete="off"
            value={typedTo}
            onChange={event => setTo(event.target.value)}
          />
        </label>
      )}
      <label className={tw('flex flex-col gap-1')}>
        <span className={tw('type-body-small text-secondary')}>
          {i18n('icu:SwarmWallet__send--amount')}
        </span>
        <input
          name="amount"
          className={tw(fieldClass, 'font-swarm-mono')}
          disabled={quoting}
          inputMode="decimal"
          placeholder="0.00000000"
          spellCheck={false}
          autoComplete="off"
          value={amount}
          onChange={event => setAmount(event.target.value)}
        />
      </label>
      <label className={tw('flex flex-col gap-1')}>
        <span className={tw('type-body-small text-secondary')}>
          {i18n('icu:SwarmWallet__send--memo')}
        </span>
        <textarea
          name="memo"
          className={tw(fieldClass, 'h-16 resize-none')}
          disabled={quoting}
          spellCheck={false}
          value={memo}
          onChange={event => setMemo(event.target.value)}
        />
      </label>
      {formExtras}
      {refusal != null ? (
        <p
          data-testid="send-refusal"
          role="alert"
          className={tw('type-body-medium text-destructive')}
        >
          {refusal}
        </p>
      ) : null}
      <div>
        <AxoButton.Root
          variant="strong-primary"
          size="md"
          pending={quoting}
          onClick={() => {
            if (quoting) {
              return;
            }
            void review();
          }}
        >
          {i18n('icu:SwarmWallet__send--review')}
        </AxoButton.Root>
      </div>
    </form>
  );
}

export function Amount({
  i18n,
  zatoshi,
  testId,
}: {
  i18n: LocalizerType;
  zatoshi: bigint;
  testId?: string;
}): JSX.Element {
  return (
    <span data-testid={testId} className={tw('font-swarm-mono text-primary')}>
      {i18n('icu:SwarmWallet__amount', {
        amount: formatZatoshiAsSwm(zatoshi),
      })}
    </span>
  );
}

function amountProblemText(
  i18n: LocalizerType,
  problem: string | null
): string {
  switch (problem) {
    case 'empty':
      return i18n('icu:SwarmWallet__refusal--empty-amount');
    case 'negative':
      return i18n('icu:SwarmWallet__refusal--negative');
    case 'too-many-decimals':
      return i18n('icu:SwarmWallet__refusal--too-many-decimals');
    case 'zero':
      return i18n('icu:SwarmWallet__refusal--zero');
    case 'too-large':
      return i18n('icu:SwarmWallet__refusal--too-large');
    case 'not-a-number':
    default:
      return i18n('icu:SwarmWallet__refusal--not-a-number');
  }
}

/** The plain-words sentence for a refused payment. */
export function refusalText(
  i18n: LocalizerType,
  refusal: SendRefusalType
): string {
  switch (refusal.kind) {
    case 'invalid-address':
      // The wallet's own sentence names the network the address belongs to.
      return (
        refusal.detail ?? i18n('icu:SwarmWallet__refusal--invalid-address')
      );
    case 'invalid-amount':
      return amountProblemText(i18n, refusal.detail);
    case 'invalid-memo':
      return refusal.detail === 'transparent'
        ? i18n('icu:SwarmWallet__refusal--memo-transparent')
        : i18n('icu:SwarmWallet__refusal--memo-too-long');
    case 'insufficient-funds':
      if (refusal.needZat != null && refusal.haveZat != null) {
        return i18n('icu:SwarmWallet__refusal--insufficient', {
          need: formatZatoshiAsSwm(zatoshiFromString(refusal.needZat)),
          have: formatZatoshiAsSwm(zatoshiFromString(refusal.haveZat)),
        });
      }
      return i18n('icu:SwarmWallet__refusal--insufficient-plain');
    case 'not-ready':
      return i18n('icu:SwarmWallet__refusal--not-ready');
    case 'offline':
      return i18n('icu:SwarmWallet__refusal--offline');
    case 'quote-expired':
      return i18n('icu:SwarmWallet__refusal--quote-expired');
    case 'rejected':
    default:
      return i18n('icu:SwarmWallet__refusal--rejected');
  }
}
