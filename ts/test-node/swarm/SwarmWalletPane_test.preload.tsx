// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): the Wallet pane in each of its states, rendered to
// markup with the real English strings. What must hold: loading says so, an
// unreachable light server is said in plain words and offers a retry and no
// send form, and a ready wallet shows the network, the height, the balance
// with eight decimals, the address with its QR code, and the send form.

import { assert } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';

import i18n from '../util/i18n.node.ts';
import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import {
  SwarmWalletPane,
  refusalText,
} from '../../components/SwarmWalletPane.dom.tsx';
import type { SwarmWalletPaneProps } from '../../components/SwarmWalletPane.dom.tsx';
import type { SwarmWalletStateType } from '../../types/SwarmWallet.std.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const ADDRESS = bech32mAddress('swm', 11);
const TXID = 'ab'.repeat(32);

const MAINNET = {
  id: 'mainnet',
  chain: 'swarm-mainnet',
  server: 'lwd-main.swarm.green:8443',
  explorer: 'https://mainnet.explore.swarm.green/',
} as const;

function state(overrides: Partial<SwarmWalletStateType>): SwarmWalletStateType {
  return {
    status: 'ready',
    problem: null,
    network: MAINNET,
    canSwitchNetwork: false,
    serverHeight: 1438,
    syncedHeight: 1438,
    syncing: false,
    genesisVerified: true,
    encryptedAtRest: true,
    balance: { confirmedZat: '0', pendingZat: '0', totalZat: '0' },
    address: ADDRESS,
    transactions: [],
    checkedAt: 1_790_000_000_000,
    ...overrides,
  };
}

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

function render(walletState: SwarmWalletStateType | undefined): string {
  const props: SwarmWalletPaneProps = {
    i18n,
    state: walletState,
    onRestore: async () => null,
    onRetry: () => undefined,
    onQuote: async () => ({
      ok: false,
      refusal: {
        kind: 'rejected',
        detail: null,
        needZat: null,
        haveZat: null,
      },
    }),
    onConfirm: async () => ({
      ok: false,
      refusal: {
        kind: 'rejected',
        detail: null,
        needZat: null,
        haveZat: null,
      },
    }),
    onCancelQuote: () => undefined,
    onSetNetwork: () => undefined,
    onCopyAddress: () => undefined,
    onRevealRecoveryPhrase: async () => ({ ok: true }),
  };
  return renderToStaticMarkup(
    <AxoProvider
      resolvedAppLocale={{
        tag: 'en' as AxoIntl.AppLocaleTag,
        direction: 'ltr',
      }}
      systemPreferredLanguages={new Set()}
      messages={AXO_MESSAGES}
    >
      <SwarmWalletPane {...props} />
    </AxoProvider>
  );
}

describe('SWARM wallet: the Wallet pane', () => {
  it('says it is loading before the first answer', () => {
    const html = render(undefined);
    assert.include(html, 'data-wallet-status="loading"');
    assert.include(html, 'Opening your wallet');
    assert.notInclude(html, 'data-testid="send-form"');
  });

  it('says in plain words that the network cannot be reached', () => {
    const html = render(
      state({
        status: 'offline',
        problem: 'offline',
        balance: null,
        address: null,
        serverHeight: null,
        syncedHeight: null,
      })
    );
    assert.include(html, 'data-wallet-status="offline"');
    assert.include(html, 'Can’t reach the SWARM network');
    assert.include(html, 'lwd-main.swarm.green:8443');
    assert.include(html, 'chats keep working');
    assert.include(html, 'Try again');
    // Nothing that suggests money can move while nothing can be checked.
    assert.notInclude(html, 'data-testid="send-form"');
    assert.notInclude(html, ADDRESS);
  });

  it('keeps the last known balance on screen while offline', () => {
    const html = render(
      state({
        status: 'offline',
        problem: 'offline',
        balance: {
          confirmedZat: '150000000',
          pendingZat: '0',
          totalZat: '150000000',
        },
      })
    );
    assert.include(html, 'Last known balance');
    assert.include(html, '1.50000000 SWM');
    assert.notInclude(html, 'data-testid="send-form"');
  });

  // SWARM addition (B6, 2026-09-29): "Recovery phrase".
  describe('the recovery phrase card', () => {
    it('offers the words, says who owns them, and holds none of them', () => {
      const html = render(state({}));
      assert.include(html, 'data-testid="recovery-phrase"');
      assert.include(html, 'Recovery phrase');
      assert.include(html, 'anyone who has them owns both');
      assert.include(html, 'Show recovery phrase');
      // The pane is never given the words, so it cannot draw them.
      assert.notInclude(html, 'data-testid="recovery-words"');
    });

    it('is offered while offline when the wallet is open, not before it opens', () => {
      const open = render(
        state({
          status: 'offline',
          problem: 'offline',
          balance: { confirmedZat: '0', pendingZat: '0', totalZat: '0' },
        })
      );
      assert.include(open, 'data-testid="recovery-phrase"');
      for (const status of ['no-wallet', 'opening', 'unavailable'] as const) {
        assert.notInclude(
          render(state({ status, balance: null, address: null })),
          'data-testid="recovery-phrase"',
          status
        );
      }
      assert.notInclude(
        render(state({ status: 'offline', problem: 'offline', balance: null })),
        'data-testid="recovery-phrase"'
      );
    });
  });

  it('shows a ready wallet: network, height, balance, address, send', () => {
    const html = render(
      state({
        balance: {
          confirmedZat: '123456789',
          pendingZat: '25000',
          totalZat: '123481789',
        },
      })
    );
    assert.include(html, 'data-wallet-status="ready"');
    assert.include(html, 'SWARM mainnet');
    assert.include(html, 'Light server lwd-main.swarm.green:8443');
    assert.include(html, 'Block 1,438');
    assert.include(html, 'Up to date');
    assert.include(html, 'Chain checked');
    assert.include(html, '1.23456789 SWM');
    assert.include(html, '0.00025000 SWM');
    assert.include(html, `data-testid="address"`);
    assert.include(html, ADDRESS);
    assert.include(html, 'alt="QR code of your SWARM address"');
    assert.include(html, 'data:image/svg+xml');
    assert.include(html, 'data-testid="send-form"');
    assert.include(html, 'Review payment');
    assert.include(html, 'No transactions yet.');
    assert.notInclude(html, 'data-testid="developer-network"');
  });

  it('says how far a wallet still has to catch up', () => {
    const html = render(state({ syncedHeight: 1000, syncing: true }));
    assert.include(html, 'Catching up: block 1,000 of 1,438');
  });

  it('links each transaction to the explorer page that exists', () => {
    const html = render(
      state({
        transactions: [
          {
            txid: TXID,
            direction: 'out',
            amountZat: '10000',
            feeZat: '10000',
            blockHeight: 1437,
            timestamp: 1_790_000_000,
            memo: 'lunch',
          },
          {
            txid: 'cd'.repeat(32),
            direction: 'unknown',
            amountZat: '5',
            feeZat: null,
            blockHeight: null,
            timestamp: null,
            memo: null,
          },
        ],
      })
    );
    assert.include(
      html,
      `href="https://mainnet.explore.swarm.green/transactions/${TXID}"`
    );
    assert.notInclude(html, '/tx/');
    assert.include(html, 'Sent');
    assert.include(html, '−0.00010000 SWM');
    assert.include(html, 'Block 1,437');
    assert.include(html, 'lunch');
    // Unknown stays unknown: no sign, not "Received".
    assert.include(html, 'Not yet in a block');
    assert.include(html, '>0.00000005 SWM<');
  });

  it('asks for the 24 words when this computer has no wallet yet', () => {
    const html = render(
      state({ status: 'no-wallet', balance: null, address: null })
    );
    assert.include(html, 'data-wallet-status="no-wallet"');
    assert.include(html, 'Open your wallet');
    assert.include(html, 'the 24 words you wrote down');
    assert.notInclude(html, 'data-testid="send-form"');
  });

  it('says so when the build has no wallet component', () => {
    const html = render(
      state({ status: 'unavailable', problem: 'addon-missing', balance: null })
    );
    assert.include(html, 'has no wallet component');
    assert.include(html, 'Chats work as usual');
  });

  it('names testnet as worthless, and offers the switch only to developers', () => {
    const html = render(
      state({
        canSwitchNetwork: true,
        network: {
          id: 'testnet',
          chain: 'swarm-testnet',
          server: 'lwd.swarm.green:443',
          explorer: 'https://explore.swarm.green/',
        },
      })
    );
    assert.include(html, 'SWARM testnet (coins have no value)');
    assert.include(html, 'data-testid="developer-network"');
  });

  it('warns when the wallet file is not encrypted at rest', () => {
    const html = render(state({ encryptedAtRest: false }));
    assert.include(html, 'stored unencrypted');
  });

  describe('refusals, in plain words', () => {
    const refusal = (overrides: Parameters<typeof refusalText>[1]) =>
      refusalText(i18n, overrides);

    it('says how much is needed and how much there is', () => {
      assert.strictEqual(
        refusal({
          kind: 'insufficient-funds',
          detail: null,
          needZat: '10000',
          haveZat: '0',
        }),
        'Not enough SWM. This payment needs 0.00010000 SWM and 0.00000000 SWM is available.'
      );
    });

    it('passes the wallet’s sentence about a wrong-network address', () => {
      const detail =
        'That is a SWARM Testnet address (it starts "swarm1…"), and this wallet is on SWARM.';
      assert.strictEqual(
        refusal({
          kind: 'invalid-address',
          detail,
          needZat: null,
          haveZat: null,
        }),
        detail
      );
    });

    it('explains every other refusal', () => {
      for (const kind of [
        'invalid-memo',
        'not-ready',
        'offline',
        'quote-expired',
        'rejected',
      ] as const) {
        const text = refusal({
          kind,
          detail: null,
          needZat: null,
          haveZat: null,
        });
        assert.isAbove(text.length, 10, kind);
        assert.notInclude(text, 'icu:', kind);
      }
      assert.include(
        refusal({
          kind: 'invalid-amount',
          detail: 'too-many-decimals',
          needZat: null,
          haveZat: null,
        }),
        '8 decimal places'
      );
    });
  });
});
