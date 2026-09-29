// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): what a person sees of payments inside a chat,
// rendered with the real English strings. What must hold:
// - a received notice says "X SWM sent to you - waiting for your wallet to see
//   it" and never "Received" until the wallet has found the transaction, and
//   then shows the wallet's amount;
// - a received request offers Share and Ignore, and stops asking once
//   answered; a kept address offers Pay;
// - Pay with SWARM shows the address with the message it came from, and
//   "Include my address" is off until ticked; sharing defaults to an address
//   just for this chat;
// - the Wallet pane says who a transaction was with.

import { assert } from 'chai';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import i18n from '../util/i18n.node.ts';
import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import { SwarmPaymentBubble } from '../../components/conversation/SwarmPaymentBubble.dom.tsx';
import type { SwarmPaymentBubbleProps } from '../../components/conversation/SwarmPaymentBubble.dom.tsx';
import { SwarmChatPaymentDialogBody } from '../../components/SwarmChatPaymentDialog.dom.tsx';
import type { SwarmChatPaymentDialogProps } from '../../components/SwarmChatPaymentDialog.dom.tsx';
import { SwarmWalletPane } from '../../components/SwarmWalletPane.dom.tsx';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type { SwarmPaymentEvent } from '../../types/Payment.std.ts';
import type { SwarmWalletStateType } from '../../types/SwarmWallet.std.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const TXID = '4e'.repeat(32);
const THEIR_ADDRESS = bech32mAddress('swm', 31);

const AXO_MESSAGES: AxoIntl.Messages = {
  'AxoAlertDialog.Cancel': 'Cancel',
  'AxoButton.Pending': 'Pending',
  'AxoDialog.Back': 'Back',
  'AxoDialog.Close': 'Close',
  'AxoTextField.Clear': 'Clear',
  'AxoPasswordField.Reveal': 'Show Password',
  'AxoBadge.MaxOverflow': (max: number) => `${max}+`,
  'AxoContactName.InSystemContactsLabel': 'This person is in your contacts.',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <AxoProvider
      resolvedAppLocale={{
        tag: 'en' as AxoIntl.AppLocaleTag,
        direction: 'ltr',
      }}
      systemPreferredLanguages={new Set()}
      messages={AXO_MESSAGES}
    >
      {node}
    </AxoProvider>
  );
}

/** Markup to text: entities decoded, tags dropped. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const NOTICE: SwarmPaymentEvent = {
  kind: PaymentEventKind.SwarmNotification,
  txid: TXID,
  amountZat: '1000000',
  memoHash: null,
  chain: 'swarm-testnet',
  senderAddress: null,
  note: null,
};

function bubble(overrides: Partial<SwarmPaymentBubbleProps>): string {
  return render(
    <SwarmPaymentBubble
      i18n={i18n}
      messageId="m1"
      conversationId="c1"
      direction="incoming"
      payment={NOTICE}
      senderTitle="Ada"
      conversationTitle="Ada"
      senderIsMe={false}
      explorer="https://explore.swarm.green/"
      {...overrides}
    />
  );
}

function wallet(
  overrides: Partial<SwarmWalletStateType> = {}
): SwarmWalletStateType {
  return {
    status: 'ready',
    problem: null,
    network: {
      id: 'testnet',
      chain: 'swarm-testnet',
      server: 'lwd.swarm.green:443',
      explorer: 'https://explore.swarm.green/',
    },
    canSwitchNetwork: true,
    serverHeight: 7005,
    syncedHeight: 7005,
    syncing: false,
    genesisVerified: true,
    encryptedAtRest: true,
    balance: {
      confirmedZat: '20000000',
      pendingZat: '0',
      totalZat: '20000000',
    },
    address: bech32mAddress('swarm', 32),
    transactions: [],
    checkedAt: 1,
    ...overrides,
  };
}

function dialog(overrides: Partial<SwarmChatPaymentDialogProps>): string {
  const refused = {
    ok: false as const,
    refusal: {
      kind: 'rejected' as const,
      detail: null,
      needZat: null,
      haveZat: null,
    },
  };
  return render(
    <SwarmChatPaymentDialogBody
      i18n={i18n}
      mode="pay"
      contactName="Ada"
      wallet={wallet()}
      theirAddress={{
        address: THEIR_ADDRESS,
        origin: "From Ada's message (Today 10:40 PM)",
      }}
      onQuote={async () => refused}
      onConfirm={async () => refused}
      onCancelQuote={() => undefined}
      onSent={async () => true}
      onShare={async () => null}
      onRequest={async () => undefined}
      onClose={() => undefined}
      {...overrides}
    />
  );
}

describe('SWARM chat payments: what the chat shows', () => {
  describe('a received payment notice', () => {
    it('waits, with the notice’s amount, until the wallet has seen it', () => {
      const shown = text(bubble({}));
      assert.include(
        shown,
        '0.01000000 SWM sent to you — waiting for your wallet to see it'
      );
      assert.notInclude(shown, 'Received');
    });

    it('says why it waits when the wallet is not open', () => {
      const shown = text(
        bubble({
          noticeView: {
            state: 'waiting',
            claimedZat: '1000000',
            walletClosed: true,
          },
        })
      );
      assert.include(shown, 'waiting for your wallet to see it');
      assert.include(shown, 'Your wallet is not open yet');
      assert.notInclude(shown, 'Received');
    });

    it('says the wallet sees it, not that it was received, from the mempool', () => {
      const shown = text(
        bubble({
          noticeView: {
            state: 'seen',
            walletZat: '1000000',
            memo: 'none',
            memoText: null,
          },
        })
      );
      assert.include(
        shown,
        'Your wallet sees 0.01000000 SWM — not yet in a block'
      );
      assert.notInclude(shown, 'Received');
    });

    it('says received with the wallet’s amount, and what the notice claimed', () => {
      const shown = text(
        bubble({
          noticeView: {
            state: 'received',
            walletZat: '900000',
            claimedZat: '1000000',
            blockHeight: 7005,
            memo: 'mismatch',
            memoText: 'for the coffee',
          },
        })
      );
      assert.include(shown, 'Received 0.00900000 SWM');
      assert.include(shown, 'In block 7,005');
      assert.include(
        shown,
        'The message said 0.01000000 SWM; the amount above is what your wallet shows.'
      );
      assert.include(shown, 'Memo: for the coffee');
      assert.include(
        shown,
        'The memo in your wallet is not the one this message describes.'
      );
    });

    it('links the transaction on the testnet explorer', () => {
      assert.include(
        bubble({}),
        `href="https://explore.swarm.green/transactions/${TXID}"`
      );
    });
  });

  describe('a notice this account sent', () => {
    it('says what was sent and whether it is in a block yet', () => {
      const shown = text(
        bubble({
          direction: 'outgoing',
          senderIsMe: true,
          senderTitle: 'You',
          noticeView: { state: 'sent-confirmed', blockHeight: 7006 },
        })
      );
      assert.include(shown, 'You sent 0.01000000 SWM to Ada');
      assert.include(shown, 'In block 7,006');
    });
  });

  describe('an address request', () => {
    const request: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmAddressRequest,
      chain: 'swarm-testnet',
    };

    it('asks, and offers Share and Ignore', () => {
      const shown = text(
        bubble({
          payment: request,
          onShare: () => undefined,
          onIgnore: () => undefined,
        })
      );
      assert.include(shown, 'Ada wants your SWARM address');
      assert.include(shown, 'Share');
      assert.include(shown, 'Ignore');
    });

    it('stops asking once answered', () => {
      const shown = text(
        bubble({
          payment: request,
          requestAnswer: 'ignored',
          onShare: () => undefined,
          onIgnore: () => undefined,
        })
      );
      assert.include(shown, 'You ignored this request.');
      assert.notInclude(shown, 'Share');
    });
  });

  describe('an address share', () => {
    const share: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmAddressShare,
      chain: 'swarm-mainnet',
      address: THEIR_ADDRESS,
    };

    it('says it was kept for this chat, and offers to pay it', () => {
      const shown = text(
        bubble({
          payment: share,
          shareStatus: { kind: 'kept' },
          onPay: () => undefined,
        })
      );
      assert.include(shown, 'Ada shared their SWARM address');
      assert.include(shown, THEIR_ADDRESS);
      assert.include(shown, 'Saved for paying Ada in this chat.');
      assert.include(shown, 'Pay Ada');
    });

    it('says why an address was not kept, and offers nothing to pay', () => {
      const shown = text(
        bubble({
          payment: share,
          shareStatus: {
            kind: 'refused',
            reason: 'That is a SWARM Testnet address.',
          },
          onPay: () => undefined,
        })
      );
      assert.include(shown, 'Not saved: That is a SWARM Testnet address.');
      assert.notInclude(shown, 'Pay Ada');
    });
  });

  describe('Pay with SWARM', () => {
    it('pays the conversation’s address and says which message it came from', () => {
      const html = dialog({});
      const shown = text(html);
      assert.include(shown, THEIR_ADDRESS);
      assert.include(shown, "From Ada's message (Today 10:40 PM)");
      assert.include(shown, 'Review payment');
      // The address is not a field anyone can type into here.
      assert.notInclude(html, 'name="to"');
    });

    it('leaves "include my address" off until it is ticked', () => {
      const html = dialog({});
      assert.include(text(html), 'Include my address so Ada can pay me back');
      assert.match(html, /role="checkbox"[^>]*aria-checked="false"/);
    });

    it('offers to ask for an address when the chat has none', () => {
      const shown = text(dialog({ theirAddress: undefined }));
      assert.include(
        shown,
        "Ada hasn't shared a SWARM address in this chat yet."
      );
      assert.include(shown, 'Ask for an address');
      assert.notInclude(shown, 'Review payment');
    });

    it('says so when the wallet is not open, and offers no payment', () => {
      const shown = text(dialog({ wallet: wallet({ status: 'opening' }) }));
      assert.include(shown, 'Your wallet is not open yet.');
      assert.notInclude(shown, 'Review payment');
    });
  });

  describe('Share SWARM address', () => {
    it('defaults to an address just for this chat', () => {
      const html = dialog({ mode: 'share' });
      assert.include(
        text(html),
        'Use an address just for this chat (recommended)'
      );
      assert.match(html, /role="checkbox"[^>]*aria-checked="true"/);
    });
  });

  describe('the Wallet pane', () => {
    it('says who a transaction was with when a chat’s notice named it', () => {
      const html = render(
        <SwarmWalletPane
          i18n={i18n}
          state={wallet({
            transactions: [
              {
                txid: TXID,
                direction: 'in',
                amountZat: '1000000',
                feeZat: null,
                blockHeight: 7005,
                timestamp: null,
                memo: null,
              },
            ],
          })}
          onRestore={async () => null}
          onRetry={() => undefined}
          onQuote={async () => {
            throw new Error('not in this test');
          }}
          onConfirm={async () => {
            throw new Error('not in this test');
          }}
          onCancelQuote={() => undefined}
          onSetNetwork={() => undefined}
          onCopyAddress={() => undefined}
          onRevealRecoveryPhrase={async () => ({ ok: true })}
          transactionLabels={{
            [TXID]: { title: 'Ada', direction: 'incoming' },
          }}
        />
      );
      assert.include(text(html), 'Received · from Ada');
    });
  });
});
