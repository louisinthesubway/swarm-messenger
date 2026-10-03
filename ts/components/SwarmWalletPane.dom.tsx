// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 1): the Wallet pane.
//
// Presentational only: it draws the state the wallet service reports and hands
// the person's intentions back through callbacks. It holds no key and no seed,
// and it never writes an address or an amount to a log. The one secret it ever
// touches is the recovery phrase typed into the restore form, which goes
// straight to the callback and is cleared from the field. ("Recovery phrase",
// B6, only asks the main process to show the words in a window of its own;
// they never come here.)
//
// Sending takes two deliberate steps: "Review payment" asks the wallet for a
// quote (nothing moves), and only the button on the confirmation screen, which
// names the amount, the fee and the address, sends. Since M3 wave 2 that flow
// is SwarmSendFlow.dom.tsx, shared with "Pay with SWARM" in a chat.

import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { QrCode } from './QrCode.dom.tsx';
import { Amount, SwarmSendFlow } from './SwarmSendFlow.dom.tsx';
import {
  formatZatoshiAsSwm,
  zatoshiFromString,
} from '../util/swarm/swmAmount.std.ts';
import {
  countRecoveryPhraseWords,
  recoveryPhraseFromText,
} from '../util/swarm/recoveryPhraseText.std.ts';
import { explorerTransactionUrl } from '../types/SwarmWallet.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';
import type {
  ConfirmSendResultType,
  QuoteSendResultType,
  RevealRecoveryPhraseResultType,
  SwarmWalletNetworkIdType,
  SwarmWalletProblemType,
  SwarmWalletStateType,
  SwarmWalletTransactionType,
} from '../types/SwarmWallet.std.ts';

// The refusal sentences moved with the send flow; the pane's tests read them
// from here.
export { refusalText } from './SwarmSendFlow.dom.tsx';

/**
 * SWARM addition (M3 wave 2): who a transaction was with, when a payment
 * notice in a chat named it. By txid.
 */
export type SwarmTransactionLabelType = Readonly<{
  title: string;
  direction: 'incoming' | 'outgoing';
}>;

export type SwarmWalletPaneProps = Readonly<{
  i18n: LocalizerType;
  /** Undefined until the wallet service has answered once. */
  state: SwarmWalletStateType | undefined;
  onRestore: (phrase: string) => Promise<SwarmWalletProblemType | null>;
  onRetry: () => void;
  onQuote: (request: {
    to: string;
    amount: string;
    memo: string;
  }) => Promise<QuoteSendResultType>;
  onConfirm: (quoteId: string) => Promise<ConfirmSendResultType>;
  onCancelQuote: () => void;
  onSetNetwork: (network: SwarmWalletNetworkIdType) => void;
  onCopyAddress: (address: string) => void;
  /** SWARM addition (M3 wave 2): "from Ada" beside a transaction, by txid. */
  transactionLabels?: Readonly<Record<string, SwarmTransactionLabelType>>;
  /**
   * SWARM addition (B6, 2026-09-29): asks the main process to show the
   * recovery phrase in a window of its own. The answer never holds the words.
   */
  onRevealRecoveryPhrase: () => Promise<RevealRecoveryPhraseResultType>;
}>;

export function SwarmWalletPane(props: SwarmWalletPaneProps): JSX.Element {
  const { i18n, state } = props;

  return (
    <div
      data-testid="SwarmWalletPane"
      data-wallet-status={state?.status ?? 'loading'}
      className={tw('flex size-full flex-col overflow-y-auto')}
    >
      <div className={tw('mx-auto flex w-full max-w-160 flex-col gap-6 p-6')}>
        <Header i18n={i18n} state={state} />
        <Body {...props} />
        {state?.canSwitchNetwork === true ? (
          <DeveloperNetwork
            i18n={i18n}
            network={state.network.id}
            onSetNetwork={props.onSetNetwork}
          />
        ) : null}
      </div>
    </div>
  );
}

function Body(props: SwarmWalletPaneProps): JSX.Element {
  const { i18n, state } = props;

  if (state == null) {
    return <Notice testId="loading">{i18n('icu:SwarmWallet__loading')}</Notice>;
  }

  switch (state.status) {
    case 'unavailable':
      return (
        <Notice testId="unavailable">
          {i18n('icu:SwarmWallet__unavailable')}
        </Notice>
      );
    case 'opening':
      return (
        <Notice testId="opening">{i18n('icu:SwarmWallet__opening')}</Notice>
      );
    case 'no-wallet':
      return <RestoreForm i18n={i18n} onRestore={props.onRestore} />;
    case 'offline':
      return <Offline {...props} state={state} />;
    case 'error':
      return (
        <section data-testid="error" className={tw('flex flex-col gap-3')}>
          <p className={tw('type-body-medium text-primary')}>
            {problemText(i18n, state)}
          </p>
          <div>
            <AxoButton.Root
              variant="subtle-secondary"
              size="md"
              onClick={props.onRetry}
            >
              {i18n('icu:SwarmWallet__retry')}
            </AxoButton.Root>
          </div>
        </section>
      );
    case 'ready':
      return <Ready {...props} state={state} />;
    default:
      return (
        <Notice testId="error">
          {i18n('icu:SwarmWallet__error--unexpected')}
        </Notice>
      );
  }
}

// Header -----------------------------------------------------------------------

function Header({
  i18n,
  state,
}: {
  i18n: LocalizerType;
  state: SwarmWalletStateType | undefined;
}): JSX.Element {
  return (
    <header className={tw('flex flex-col gap-1')}>
      <h1 className={tw('type-title-large text-primary')}>
        {i18n('icu:SwarmWallet__title')}
      </h1>
      {state != null ? (
        <>
          <p
            data-testid="network"
            className={tw('type-body-medium text-primary')}
          >
            {state.network.id === 'mainnet'
              ? i18n('icu:SwarmWallet__network--mainnet')
              : i18n('icu:SwarmWallet__network--testnet')}
          </p>
          <p className={tw('type-body-small text-secondary')}>
            {i18n('icu:SwarmWallet__server', {
              server: state.network.server,
            })}
          </p>
          {state.status === 'ready' && state.serverHeight != null ? (
            <p
              data-testid="height"
              className={tw('type-body-small text-secondary')}
            >
              {i18n('icu:SwarmWallet__height', { height: state.serverHeight })}
              {' · '}
              {syncText(i18n, state)}
              {' · '}
              {state.genesisVerified === true
                ? i18n('icu:SwarmWallet__genesis--verified')
                : i18n('icu:SwarmWallet__genesis--unstated')}
            </p>
          ) : null}
        </>
      ) : null}
    </header>
  );
}

function syncText(i18n: LocalizerType, state: SwarmWalletStateType): string {
  const { serverHeight, syncedHeight } = state;
  if (
    serverHeight != null &&
    syncedHeight != null &&
    syncedHeight >= serverHeight
  ) {
    return i18n('icu:SwarmWallet__synced');
  }
  if (serverHeight != null && syncedHeight != null) {
    return i18n('icu:SwarmWallet__syncing', {
      synced: syncedHeight,
      height: serverHeight,
    });
  }
  return i18n('icu:SwarmWallet__syncing--starting');
}

// States --------------------------------------------------------------------------

function Notice({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <p data-testid={testId} className={tw('type-body-medium text-secondary')}>
      {children}
    </p>
  );
}

function problemText(i18n: LocalizerType, state: SwarmWalletStateType): string {
  switch (state.problem) {
    case 'wrong-chain':
      return i18n('icu:SwarmWallet__error--wrong-chain', {
        server: state.network.server,
      });
    case 'wallet-file':
      return i18n('icu:SwarmWallet__error--wallet-file');
    case 'addon-missing':
      return i18n('icu:SwarmWallet__unavailable');
    default:
      return i18n('icu:SwarmWallet__error--unexpected');
  }
}

function Offline({
  i18n,
  state,
  onRetry,
  onRevealRecoveryPhrase,
}: SwarmWalletPaneProps & { state: SwarmWalletStateType }): JSX.Element {
  return (
    <section data-testid="offline" className={tw('flex flex-col gap-3')}>
      <h2 className={tw('type-title-medium text-primary')}>
        {i18n('icu:SwarmWallet__offline--title')}
      </h2>
      <p className={tw('type-body-medium text-primary')}>
        {i18n('icu:SwarmWallet__offline--body', {
          server: state.network.server,
        })}
      </p>
      <div>
        <AxoButton.Root variant="subtle-secondary" size="md" onClick={onRetry}>
          {i18n('icu:SwarmWallet__retry')}
        </AxoButton.Root>
      </div>
      {state.balance != null ? (
        <Card title={i18n('icu:SwarmWallet__offline--last-known')}>
          <BalanceRows i18n={i18n} state={state} />
        </Card>
      ) : null}
      {/* SWARM addition (B6): the words are in the wallet file, not on the
          light server, so they can be shown while it is unreachable. */}
      {state.balance != null ? (
        <RecoveryPhrase
          i18n={i18n}
          onRevealRecoveryPhrase={onRevealRecoveryPhrase}
        />
      ) : null}
    </section>
  );
}

function RestoreForm({
  i18n,
  onRestore,
}: {
  i18n: LocalizerType;
  onRestore: (phrase: string) => Promise<SwarmWalletProblemType | null>;
}): JSX.Element {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<SwarmWalletProblemType | null>(null);

  // SWARM change (B6, 2026-09-29): a pasted recovery phrase file counts as
  // its 24 words; its warning line is not a word.
  const wordCount = countRecoveryPhraseWords(phrase);

  const submit = async () => {
    if (busy || wordCount !== 24) {
      return;
    }
    setBusy(true);
    setProblem(null);
    const typed = recoveryPhraseFromText(phrase);
    // The words leave the field as they leave for the main process.
    setPhrase('');
    let answer: SwarmWalletProblemType | null;
    try {
      answer = await onRestore(typed);
    } catch {
      answer = 'unexpected';
    }
    setProblem(answer);
    setBusy(false);
  };

  return (
    <section data-testid="no-wallet" className={tw('flex flex-col gap-3')}>
      <h2 className={tw('type-title-medium text-primary')}>
        {i18n('icu:SwarmWallet__restore--title')}
      </h2>
      <p className={tw('type-body-medium text-secondary')}>
        {i18n('icu:SwarmWallet__restore--body')}
      </p>
      <textarea
        aria-label={i18n('icu:SwarmWallet__restore--placeholder')}
        className={tw(
          'h-28 w-full resize-none rounded-lg border border-primary',
          'bg-surface-primary p-3 type-body-medium text-primary'
        )}
        disabled={busy}
        placeholder={i18n('icu:SwarmWallet__restore--placeholder')}
        spellCheck={false}
        autoComplete="off"
        value={phrase}
        onChange={event => setPhrase(event.target.value)}
      />
      {problem != null ? (
        <p className={tw('type-body-medium text-destructive')}>
          {problem === 'wrong-phrase'
            ? i18n('icu:SwarmWallet__restore--wrong-phrase')
            : i18n('icu:SwarmWallet__restore--invalid-phrase')}
        </p>
      ) : null}
      <div>
        <AxoButton.Root
          variant="strong-primary"
          size="md"
          disabled={wordCount !== 24}
          pending={busy}
          onClick={() => {
            void submit();
          }}
        >
          {i18n('icu:SwarmWallet__restore--button')}
        </AxoButton.Root>
      </div>
    </section>
  );
}

// Ready -------------------------------------------------------------------------

function Ready(
  props: SwarmWalletPaneProps & { state: SwarmWalletStateType }
): JSX.Element {
  const { i18n, state } = props;
  return (
    <div data-testid="ready" className={tw('flex flex-col gap-6')}>
      {state.networkRestarted === true ? (
        <p
          data-testid="network-restarted"
          className={tw('type-body-medium text-primary')}
        >
          {i18n('icu:SwarmWallet__network-restarted')}
        </p>
      ) : null}
      <Card title={i18n('icu:SwarmWallet__balance--title')}>
        <BalanceRows i18n={i18n} state={state} />
        {state.encryptedAtRest === false ? (
          <p className={tw('type-body-small text-destructive')}>
            {i18n('icu:SwarmWallet__not-encrypted')}
          </p>
        ) : null}
      </Card>
      {state.address != null ? (
        <Receive
          i18n={i18n}
          address={state.address}
          onCopyAddress={props.onCopyAddress}
        />
      ) : null}
      <SwarmSendFlow
        i18n={i18n}
        explorer={state.network.explorer}
        frame={(title, children) => <Card title={title}>{children}</Card>}
        onQuote={props.onQuote}
        onConfirm={props.onConfirm}
        onCancelQuote={props.onCancelQuote}
      />
      <History i18n={i18n} state={state} labels={props.transactionLabels} />
      <RecoveryPhrase
        i18n={i18n}
        onRevealRecoveryPhrase={props.onRevealRecoveryPhrase}
      />
    </div>
  );
}

// Recovery phrase (B6) -----------------------------------------------------------

/**
 * SWARM addition (B6, 2026-09-29): "Recovery phrase". One sentence on what the
 * words are, and a button that asks the main process to show them in a window
 * of its own. The words never come to this pane.
 */
function RecoveryPhrase({
  i18n,
  onRevealRecoveryPhrase,
}: {
  i18n: LocalizerType;
  onRevealRecoveryPhrase: () => Promise<RevealRecoveryPhraseResultType>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<
    'not-ready' | 'not-confirmed' | 'failed' | null
  >(null);

  const reveal = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const result = await onRevealRecoveryPhrase();
      setRefusal(result.ok ? null : result.refusal);
    } catch {
      setRefusal('failed');
    }
    setBusy(false);
  };

  return (
    <section data-testid="recovery-phrase">
      <Card title={i18n('icu:SwarmWallet__recovery--title')}>
        <p className={tw('type-body-medium text-primary')}>
          {i18n('icu:SwarmWallet__recovery--body')}
        </p>
        {refusal != null ? (
          <p className={tw('type-body-small text-destructive')}>
            {refusal === 'not-ready'
              ? i18n('icu:SwarmWallet__recovery--not-ready')
              : null}
            {refusal === 'not-confirmed'
              ? i18n('icu:SwarmWallet__recovery--not-confirmed')
              : null}
            {refusal === 'failed'
              ? i18n('icu:SwarmWallet__recovery--failed')
              : null}
          </p>
        ) : null}
        <div>
          <AxoButton.Root
            variant="subtle-secondary"
            size="md"
            pending={busy}
            onClick={() => {
              void reveal();
            }}
          >
            {i18n('icu:SwarmWallet__recovery--button')}
          </AxoButton.Root>
        </div>
      </Card>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section
      className={tw('flex flex-col gap-3 rounded-lg bg-surface-secondary p-4')}
    >
      <h2 className={tw('type-title-small text-primary')}>{title}</h2>
      {children}
    </section>
  );
}

function BalanceRows({
  i18n,
  state,
}: {
  i18n: LocalizerType;
  state: SwarmWalletStateType;
}): JSX.Element | null {
  if (state.balance == null) {
    return null;
  }
  return (
    <dl className={tw('grid grid-cols-[auto_1fr] gap-x-6 gap-y-1')}>
      <dt className={tw('type-body-medium text-secondary')}>
        {i18n('icu:SwarmWallet__balance--confirmed')}
      </dt>
      <dd className={tw('type-title-medium')}>
        <Amount
          i18n={i18n}
          testId="balance-confirmed"
          zatoshi={zatoshiFromString(state.balance.confirmedZat)}
        />
      </dd>
      <dt className={tw('type-body-medium text-secondary')}>
        {i18n('icu:SwarmWallet__balance--pending')}
      </dt>
      <dd className={tw('type-body-medium')}>
        <Amount
          i18n={i18n}
          testId="balance-pending"
          zatoshi={zatoshiFromString(state.balance.pendingZat)}
        />
      </dd>
    </dl>
  );
}

function Receive({
  i18n,
  address,
  onCopyAddress,
}: {
  i18n: LocalizerType;
  address: string;
  onCopyAddress: (address: string) => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return undefined;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Card title={i18n('icu:SwarmWallet__receive--title')}>
      <p className={tw('type-body-small text-secondary')}>
        {i18n('icu:SwarmWallet__receive--body')}
      </p>
      <div className={tw('flex flex-wrap items-start gap-4')}>
        <div className={tw('shrink-0 rounded-md bg-[white] p-2')}>
          <QrCode
            alt={i18n('icu:SwarmWallet__receive--qr')}
            className={tw('size-40')}
            data={address}
          />
        </div>
        <div className={tw('flex min-w-0 flex-1 flex-col gap-2')}>
          <code
            data-testid="address"
            className={tw(
              'font-swarm-mono type-body-small break-all text-primary select-text'
            )}
          >
            {address}
          </code>
          <div>
            <AxoButton.Root
              variant="subtle-secondary"
              size="sm"
              onClick={() => {
                onCopyAddress(address);
                setCopied(true);
              }}
            >
              {copied
                ? i18n('icu:SwarmWallet__copied')
                : i18n('icu:SwarmWallet__copy')}
            </AxoButton.Root>
          </div>
        </div>
      </div>
    </Card>
  );
}

// History -------------------------------------------------------------------------

function History({
  i18n,
  state,
  labels,
}: {
  i18n: LocalizerType;
  state: SwarmWalletStateType;
  labels: Readonly<Record<string, SwarmTransactionLabelType>> | undefined;
}): JSX.Element {
  return (
    <Card title={i18n('icu:SwarmWallet__history--title')}>
      {state.transactions.length === 0 ? (
        <p
          data-testid="history-empty"
          className={tw('type-body-medium text-secondary')}
        >
          {i18n('icu:SwarmWallet__history--empty')}
        </p>
      ) : (
        <ul data-testid="history" className={tw('flex flex-col gap-3')}>
          {state.transactions.map((transaction, index) => (
            <HistoryRow
              // The wallet lists a transaction once per pool it was received
              // into, so a txid alone is not a unique key.
              // oxlint-disable-next-line react/no-array-index-key
              key={`${transaction.txid}-${index}`}
              i18n={i18n}
              explorer={state.network.explorer}
              transaction={transaction}
              label={labels?.[transaction.txid]}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function HistoryRow({
  i18n,
  explorer,
  transaction,
  label: chatLabel,
}: {
  i18n: LocalizerType;
  explorer: string;
  transaction: SwarmWalletTransactionType;
  label: SwarmTransactionLabelType | undefined;
}): JSX.Element {
  const { label, sign } = directionText(i18n, transaction.direction);
  return (
    <li className={tw('flex flex-col gap-0.5')}>
      <div
        className={tw('flex flex-wrap items-baseline justify-between gap-2')}
      >
        <span className={tw('type-body-medium text-primary')}>
          {label}
          {chatLabel != null ? (
            <span
              data-testid="history-chat-label"
              className={tw('type-body-small text-secondary')}
            >
              {' · '}
              {chatLabel.direction === 'incoming'
                ? i18n('icu:SwarmChat__history--from', {
                    contact: chatLabel.title,
                  })
                : i18n('icu:SwarmChat__history--to', {
                    contact: chatLabel.title,
                  })}
            </span>
          ) : null}
        </span>
        <span className={tw('font-swarm-mono type-body-medium text-primary')}>
          {sign}
          {i18n('icu:SwarmWallet__amount', {
            amount: formatZatoshiAsSwm(
              zatoshiFromString(transaction.amountZat)
            ),
          })}
        </span>
      </div>
      <div
        className={tw('flex flex-wrap items-baseline justify-between gap-2')}
      >
        <span className={tw('type-body-small text-secondary')}>
          {transaction.blockHeight == null
            ? i18n('icu:SwarmWallet__history--pending')
            : i18n('icu:SwarmWallet__history--block', {
                height: transaction.blockHeight,
              })}
        </span>
        <a
          className={tw(
            'font-swarm-mono type-body-small text-accent underline'
          )}
          href={explorerTransactionUrl(explorer, transaction.txid)}
          target="_blank"
          rel="noreferrer"
        >
          {`${transaction.txid.slice(0, 10)}…${transaction.txid.slice(-6)}`}
        </a>
      </div>
      {transaction.memo != null && transaction.memo !== '' ? (
        <p className={tw('type-body-small wrap-break-word text-secondary')}>
          {transaction.memo}
        </p>
      ) : null}
    </li>
  );
}

function directionText(
  i18n: LocalizerType,
  direction: SwarmWalletTransactionType['direction']
): { label: string; sign: string } {
  switch (direction) {
    case 'in':
      return { label: i18n('icu:SwarmWallet__history--received'), sign: '+' };
    case 'out':
      return { label: i18n('icu:SwarmWallet__history--sent'), sign: '−' };
    default:
      // A spend shown as income is the bug this avoids: unknown stays unknown.
      return { label: i18n('icu:SwarmWallet__history--unknown'), sign: '' };
  }
}

// Developer ------------------------------------------------------------------------

function DeveloperNetwork({
  i18n,
  network,
  onSetNetwork,
}: {
  i18n: LocalizerType;
  network: SwarmWalletNetworkIdType;
  onSetNetwork: (network: SwarmWalletNetworkIdType) => void;
}): JSX.Element {
  return (
    <section
      data-testid="developer-network"
      className={tw(
        'flex flex-col gap-2 rounded-lg border border-dashed border-primary p-4'
      )}
    >
      <h2 className={tw('type-body-small text-secondary')}>
        {i18n('icu:SwarmWallet__developer--title')}
      </h2>
      <div className={tw('flex gap-2')}>
        <AxoButton.Root
          variant={
            network === 'mainnet' ? 'strong-secondary' : 'implied-secondary'
          }
          size="sm"
          onClick={() => onSetNetwork('mainnet')}
        >
          {i18n('icu:SwarmWallet__developer--mainnet')}
        </AxoButton.Root>
        <AxoButton.Root
          variant={
            network === 'testnet' ? 'strong-secondary' : 'implied-secondary'
          }
          size="sm"
          onClick={() => onSetNetwork('testnet')}
        >
          {i18n('icu:SwarmWallet__developer--testnet')}
        </AxoButton.Root>
      </div>
    </section>
  );
}
