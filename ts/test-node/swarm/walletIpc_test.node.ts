// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): the main process's checks on everything the Wallet pane
// sends, and the rules that decide which wallet file is whose.

import { assert } from 'chai';

import {
  SWARM_MAINNET_PROFILE,
  SWARM_TESTNET_PROFILE,
} from 'swarm-wallet-core';

import { entropyToPhrase } from '../../util/swarm/bip39.node.ts';
import {
  SWARM_WALLET_NETWORKS,
  accountKeyForPhrase,
  accountKeyFromBase64,
  classifyWalletFailure,
  describeNetwork,
  isInsufficientFunds,
  isNetworkFailure,
  parseConfirmSendRequest,
  parseGetStateRequest,
  parseOpenWithPhraseRequest,
  parseServerOverride,
  replaceRetiredServer,
  parseSetNetworkRequest,
  redactForLog,
  sameAccountKey,
  validateSendRequest,
  walletFileNameFor,
} from '../../util/swarm/walletIpc.node.ts';
import { explorerTransactionUrl } from '../../types/SwarmWallet.std.ts';
import {
  bech32mAddress,
  damaged,
} from '../../test-helpers/swarmAddresses.std.ts';

// The same vectors the sign-in tests and the chat server's tests carry.
const ZERO_PHRASE = entropyToPhrase(new Uint8Array(32));
const ZERO_ACI_KEY = 'BdUup/KTUWFdGc1rkQy8qqoAXARjDuW2b32p1STJMl5Y';
const COUNTING_PHRASE = entropyToPhrase(
  new Uint8Array(Array.from({ length: 32 }, (_, i) => i))
);
const COUNTING_ACI_KEY = 'BUOazbfLOeK5YwjvL8ASlC5sCw/d+FZZ+q6SUesG1kJw';

const MAINNET = SWARM_MAINNET_PROFILE;
const ONE_SWM = 100_000_000n;

describe('SWARM wallet: IPC checks in the main process', () => {
  describe('the address, on mainnet', () => {
    const send = (to: string) =>
      validateSendRequest({ to, amount: '0.5' }, MAINNET, ONE_SWM);

    it('accepts a mainnet swm1 address', () => {
      const to = bech32mAddress('swm');
      const result = send(to);
      assert.isTrue(result.ok);
      assert.strictEqual(result.ok && result.send.to, to);
    });

    it('trims what was pasted around the address', () => {
      const to = bech32mAddress('swm', 3);
      const result = send(`  ${to}\n`);
      assert.strictEqual(result.ok && result.send.to, to);
    });

    it('refuses a testnet swarm1 address and says which network it is', () => {
      const result = send(bech32mAddress('swarm'));
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.strictEqual(result.refusal.kind, 'invalid-address');
        assert.include(result.refusal.detail, 'SWARM Testnet');
        assert.include(
          result.refusal.detail,
          'coins sent across them are lost'
        );
      }
    });

    it('refuses the old testnet utest1 spelling on mainnet', () => {
      const result = send(bech32mAddress('utest'));
      assert.isFalse(result.ok);
      assert.strictEqual(!result.ok && result.refusal.kind, 'invalid-address');
    });

    it('refuses a testnet transparent address on mainnet', () => {
      const result = send('tmFakeTransparentAddressAaaaaaaaaaa');
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.strictEqual(result.refusal.kind, 'invalid-address');
        assert.include(result.refusal.detail, 'SWARM Testnet');
      }
    });

    it('refuses a Zcash address', () => {
      const result = send(bech32mAddress('u'));
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.include(result.refusal.detail, 'Zcash');
      }
    });

    it('refuses a damaged checksum', () => {
      const result = send(damaged(bech32mAddress('swm')));
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.strictEqual(result.refusal.kind, 'invalid-address');
        assert.include(result.refusal.detail, 'damaged');
      }
    });

    it('refuses nonsense and an empty field', () => {
      for (const to of ['', 'hello', 'swm1', '0x1234']) {
        const result = send(to);
        assert.isFalse(result.ok, to);
        assert.strictEqual(
          !result.ok && result.refusal.kind,
          'invalid-address',
          to
        );
      }
    });

    it('accepts a mainnet transparent address', () => {
      assert.isTrue(send('s1FakeTransparentAddressAaaaaaaaaaa').ok);
    });
  });

  describe('the address, on testnet', () => {
    it('refuses a mainnet swm1 address on a testnet wallet', () => {
      const result = validateSendRequest(
        { to: bech32mAddress('swm'), amount: '1' },
        SWARM_TESTNET_PROFILE,
        ONE_SWM
      );
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.include(result.refusal.detail, 'is a SWARM address');
      }
    });

    it('accepts its own swarm1 address', () => {
      const result = validateSendRequest(
        { to: bech32mAddress('swarm'), amount: '1' },
        SWARM_TESTNET_PROFILE,
        ONE_SWM
      );
      assert.isTrue(result.ok);
    });
  });

  describe('the amount', () => {
    const to = bech32mAddress('swm');

    it('becomes zatoshi exactly', () => {
      const result = validateSendRequest(
        { to, amount: '0.00000001' },
        MAINNET,
        ONE_SWM
      );
      assert.strictEqual(result.ok && result.send.amountZat, 1n);
    });

    it('is refused with the parser’s reason', () => {
      for (const [amount, problem] of [
        ['', 'empty'],
        ['1e2', 'not-a-number'],
        ['0.000000001', 'too-many-decimals'],
        ['0', 'zero'],
        ['-1', 'negative'],
        ['30000000', 'too-large'],
      ] as const) {
        const result = validateSendRequest({ to, amount }, MAINNET, ONE_SWM);
        assert.isFalse(result.ok, amount);
        if (!result.ok) {
          assert.strictEqual(result.refusal.kind, 'invalid-amount', amount);
          assert.strictEqual(result.refusal.detail, problem, amount);
        }
      }
    });

    it('cannot be more than the wallet can spend', () => {
      const result = validateSendRequest({ to, amount: '0.0001' }, MAINNET, 0n);
      assert.isFalse(result.ok);
      if (!result.ok) {
        assert.strictEqual(result.refusal.kind, 'insufficient-funds');
        assert.strictEqual(result.refusal.needZat, '10000');
        assert.strictEqual(result.refusal.haveZat, '0');
      }
    });

    it('is refused as not ready while no balance is known', () => {
      const result = validateSendRequest({ to, amount: '1' }, MAINNET, null);
      assert.strictEqual(!result.ok && result.refusal.kind, 'not-ready');
    });
  });

  describe('the memo', () => {
    const to = bech32mAddress('swm');

    it('is optional, and empty means none', () => {
      const result = validateSendRequest(
        { to, amount: '1', memo: '' },
        MAINNET,
        ONE_SWM
      );
      assert.strictEqual(result.ok && result.send.memo, null);
    });

    it('may be 512 bytes of UTF-8 and no more', () => {
      const fits = validateSendRequest(
        { to, amount: '1', memo: 'é'.repeat(256) },
        MAINNET,
        ONE_SWM
      );
      assert.isTrue(fits.ok);
      const tooLong = validateSendRequest(
        { to, amount: '1', memo: 'é'.repeat(256) + 'x' },
        MAINNET,
        ONE_SWM
      );
      assert.isFalse(tooLong.ok);
      if (!tooLong.ok) {
        assert.strictEqual(tooLong.refusal.kind, 'invalid-memo');
        assert.strictEqual(tooLong.refusal.detail, 'too-long');
      }
    });

    it('cannot go to a transparent address', () => {
      const result = validateSendRequest(
        { to: 's1FakeTransparentAddressAaaaaaaaaaa', amount: '1', memo: 'hi' },
        MAINNET,
        ONE_SWM
      );
      assert.isFalse(result.ok);
      assert.strictEqual(!result.ok && result.refusal.detail, 'transparent');
    });
  });

  describe('the shape of a request', () => {
    it('refuses anything that is not the request object', () => {
      for (const input of [
        undefined,
        null,
        'swm1',
        42,
        [],
        { to: 1, amount: '1' },
        { to: 'x'.repeat(2000), amount: '1' },
        { to: bech32mAddress('swm'), amount: 1 },
      ]) {
        const result = validateSendRequest(input, MAINNET, ONE_SWM);
        assert.isFalse(result.ok);
      }
    });

    it('reads a quote id and nothing else', () => {
      const id = '0123456789abcdef0123456789abcdef';
      assert.strictEqual(parseConfirmSendRequest({ quoteId: id }), id);
      assert.isUndefined(
        parseConfirmSendRequest({ quoteId: id.toUpperCase() })
      );
      assert.isUndefined(parseConfirmSendRequest({ quoteId: 'short' }));
      assert.isUndefined(parseConfirmSendRequest(undefined));
    });

    it('reads a network and nothing else', () => {
      assert.strictEqual(
        parseSetNetworkRequest({ network: 'testnet' }),
        'testnet'
      );
      assert.strictEqual(
        parseSetNetworkRequest({ network: 'mainnet' }),
        'mainnet'
      );
      assert.isUndefined(parseSetNetworkRequest({ network: 'main' }));
      assert.isUndefined(
        parseSetNetworkRequest({ network: 'https://evil.example' })
      );
    });

    it('reads an account key only when it is one', () => {
      assert.isUndefined(parseGetStateRequest({})?.accountKey);
      assert.isUndefined(parseGetStateRequest(undefined)?.accountKey);
      const parsed = parseGetStateRequest({ accountKey: ZERO_ACI_KEY });
      assert.strictEqual(parsed?.accountKey?.length, 33);
      assert.isUndefined(parseGetStateRequest({ accountKey: 'not-a-key' }));
      assert.isUndefined(parseGetStateRequest({ accountKey: '../../etc' }));
    });
  });

  describe('the recovery phrase', () => {
    it('names the same account sign-in derived', () => {
      assert.isTrue(
        sameAccountKey(
          accountKeyForPhrase(ZERO_PHRASE),
          accountKeyFromBase64(ZERO_ACI_KEY)
        )
      );
      assert.isTrue(
        sameAccountKey(
          accountKeyForPhrase(COUNTING_PHRASE),
          accountKeyFromBase64(COUNTING_ACI_KEY)
        )
      );
    });

    it('is accepted for its own account and refused for another', () => {
      const own = parseOpenWithPhraseRequest({
        phrase: COUNTING_PHRASE,
        isNewPhrase: false,
        accountKey: COUNTING_ACI_KEY,
      });
      assert.isTrue(own.ok);

      const other = parseOpenWithPhraseRequest({
        phrase: COUNTING_PHRASE,
        isNewPhrase: false,
        accountKey: ZERO_ACI_KEY,
      });
      assert.deepStrictEqual(other, { ok: false, problem: 'wrong-phrase' });
    });

    it('defines the account when none is named (sign-in)', () => {
      const result = parseOpenWithPhraseRequest({
        phrase: `  ${ZERO_PHRASE.toUpperCase()}  `,
        isNewPhrase: true,
      });
      assert.isTrue(result.ok);
      if (result.ok) {
        assert.strictEqual(result.phrase, ZERO_PHRASE);
        assert.isTrue(result.isNewPhrase);
        assert.isTrue(
          sameAccountKey(result.accountKey, accountKeyFromBase64(ZERO_ACI_KEY))
        );
      }
    });

    it('refuses a phrase that fails the BIP-39 check', () => {
      const words = ZERO_PHRASE.split(' ');
      words[23] = 'abandon';
      for (const phrase of [words.join(' '), 'one two three', '']) {
        assert.deepStrictEqual(
          parseOpenWithPhraseRequest({ phrase, isNewPhrase: false }),
          { ok: false, problem: 'invalid-phrase' }
        );
      }
    });
  });

  describe('which wallet file is whose', () => {
    it('is one file per account, the same every time', () => {
      const zero = walletFileNameFor(accountKeyFromBase64(ZERO_ACI_KEY));
      const counting = walletFileNameFor(
        accountKeyFromBase64(COUNTING_ACI_KEY)
      );
      assert.match(zero, /^wallet-[0-9a-f]{32}\.dat$/);
      assert.notStrictEqual(zero, counting);
      assert.strictEqual(
        walletFileNameFor(accountKeyForPhrase(ZERO_PHRASE)),
        zero
      );
    });

    it('does not carry the key itself', () => {
      const name = walletFileNameFor(accountKeyFromBase64(ZERO_ACI_KEY));
      const keyHex = Buffer.from(ZERO_ACI_KEY, 'base64').toString('hex');
      assert.notInclude(keyHex, name.slice(7, 39));
    });
  });

  describe('networks and servers', () => {
    it('describes the mainnet light server as host and port', () => {
      assert.deepStrictEqual(
        describeNetwork('mainnet', MAINNET.defaultServer),
        {
          id: 'mainnet',
          chain: 'swarm-mainnet',
          server: 'lwd-main.swarm.green:443',
          explorer: 'https://explore.swarm.green/',
        }
      );
      assert.strictEqual(
        describeNetwork('testnet', SWARM_TESTNET_PROFILE.defaultServer).server,
        'lwd.swarm.green:443'
      );
    });

    it('links transactions where the explorers keep them', () => {
      const txid = 'a'.repeat(64);
      assert.strictEqual(
        explorerTransactionUrl(SWARM_WALLET_NETWORKS.mainnet.explorer, txid),
        `https://explore.swarm.green/transactions/${txid}`
      );
      assert.strictEqual(
        explorerTransactionUrl(SWARM_WALLET_NETWORKS.testnet.explorer, txid),
        `https://testnet.explore.swarm.green/transactions/${txid}`
      );
    });

    it('holds SWARM Mainnet to the chain restarted on 2 October 2026', () => {
      assert.strictEqual(
        MAINNET.genesis,
        '01b76d8a0f18c502b23ab6605e26296d189aa5770fc4a34155e5c7b250a0eff2'
      );
      assert.strictEqual(
        MAINNET.defaultServer,
        'https://lwd-main.swarm.green:443'
      );
      assert.notInclude(MAINNET.defaultServer, '8443');
    });

    it("moves a developer setting off the abandoned chain's light server", () => {
      assert.strictEqual(
        replaceRetiredServer(
          parseServerOverride('https://lwd-main.swarm.green:8443')
        ),
        'https://lwd-main.swarm.green:443'
      );
      assert.strictEqual(
        replaceRetiredServer('https://127.0.0.1:9'),
        'https://127.0.0.1:9'
      );
      assert.isUndefined(replaceRetiredServer(undefined));
    });

    it('takes a developer server override only as https host:port', () => {
      assert.strictEqual(
        parseServerOverride('https://lwd-main.swarm.green:9'),
        'https://lwd-main.swarm.green:9'
      );
      assert.strictEqual(
        parseServerOverride('https://127.0.0.1:9/some/path'),
        'https://127.0.0.1:9'
      );
      for (const bad of [
        'http://lwd-main.swarm.green:8443',
        'file:///etc/passwd',
        'https://user:pass@example.com',
        'not a url',
        '',
        42,
      ]) {
        assert.isUndefined(parseServerOverride(bad), String(bad));
      }
    });
  });

  describe('failures', () => {
    it('reads the addon’s network errors as offline', () => {
      for (const message of [
        'info_server: read: transport error ← tcp connect error ← No connection could be made because the target machine actively refused it. (os error 10061)',
        'read: transport error ← An existing connection was forcibly closed by the remote host. (os error 10054)',
        'dns error: failed to lookup address information',
        'operation timed out',
      ]) {
        assert.isTrue(isNetworkFailure(message), message);
        assert.strictEqual(classifyWalletFailure('addon', message), 'offline');
      }
      assert.strictEqual(classifyWalletFailure('timeout', 'open'), 'offline');
    });

    it('keeps the other categories apart', () => {
      assert.strictEqual(
        classifyWalletFailure('wrong-chain', 'reports genesis'),
        'wrong-chain'
      );
      assert.strictEqual(
        classifyWalletFailure('wallet-file', 'could not be sealed'),
        'wallet-file'
      );
      assert.strictEqual(
        classifyWalletFailure('addon-missing', 'no addon'),
        'addon-missing'
      );
      assert.strictEqual(
        classifyWalletFailure('addon', 'something else'),
        'unexpected'
      );
    });

    it('recognises the wallet saying it cannot cover a payment', () => {
      assert.isTrue(isInsufficientFunds('Insufficient balance: need 1000'));
      assert.isTrue(isInsufficientFunds('not enough funds'));
      assert.isFalse(isInsufficientFunds('transport error'));
    });

    it('never lets an address into the log', () => {
      const unified = bech32mAddress('swm');
      const testnet = bech32mAddress('swarm');
      const transparent = 's1FakeTransparentAddressAaaaaaaaaaa';
      const message =
        `"${unified}" is not an address this wallet can pay; ` +
        `nor is ${testnet}, nor ${transparent}.`;
      const redacted = redactForLog(message);
      assert.notInclude(redacted, unified);
      assert.notInclude(redacted, testnet);
      assert.notInclude(redacted, transparent);
      assert.include(redacted, '<address>');
      assert.include(redacted, 'is not an address this wallet can pay');
    });

    it('leaves a transaction id and ordinary words alone', () => {
      const txid = 'f'.repeat(64);
      assert.strictEqual(
        redactForLog(`sent ${txid} at block 1438`),
        `sent ${txid} at block 1438`
      );
    });
  });
});
