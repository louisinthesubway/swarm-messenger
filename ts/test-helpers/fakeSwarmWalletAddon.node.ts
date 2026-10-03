// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3): a stand-in for the SWARM wallet's Rust addon, for tests
// of the wallet worker. Shapes follow swarm-wallet-core's own fake
// (test/fakeAddon.ts, MIT), which were read off the real mainnet binary: the
// prose answers stay prose, balances use the addon's twelve key names, and the
// addresses are objects with `encoded_address`. It writes a real wallet file,
// because the wallet store seals one and a test that skips that proves nothing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  SWARM_MAINNET_GENESIS,
  SWARM_TESTNET_PROFILE,
} from 'swarm-wallet-core';
import type { NativeAddon } from 'swarm-wallet-core';

export type FakeAddonOptionsType = Readonly<{
  /** Spendable zatoshi. */
  spendable?: number;
  /** Make `send` answer `{"error": …}`, as the addon does for a refusal. */
  sendError?: string;
  /**
   * SWARM addition (M3 wave 2): what `get_value_transfers` answers, in the
   * SDK's own shape (zingolib `ValueTransfer` JSON: `status`, `blockheight`,
   * `memos`). Defaults to the wave-1 list.
   */
  valueTransfers?: ReadonlyArray<Record<string, unknown>>;
  /** SWARM addition (M3 wave 2): the address `create_new_unified_address` makes. */
  newAddress?: string;
  /**
   * SWARM addition (0.1.3): how long `get_seed` takes, as when the real addon
   * waits for a running sync or a slow light server before it can read.
   */
  seedDelayMs?: number;
  /** SWARM addition (0.1.3): make `get_seed` fail with this message. */
  seedError?: string;
  /**
   * SWARM addition (0.1.3): a sync that is still running until `stop_sync`
   * or the wallet is closed, instead of one that completes at once.
   */
  syncKeepsRunning?: boolean;
}>;

export type FakeAddonLogType = {
  calls: Array<string>;
  seedsGiven: Array<number>;
};

/** A unified address with a valid bech32m checksum, as the wrapper checks. */
export const FAKE_UNIFIED_ADDRESS =
  'swm1qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khced2letk';

export function createFakeSwarmWalletAddon(
  options: FakeAddonOptionsType = {}
): { addon: NativeAddon; log: FakeAddonLogType } {
  const log: FakeAddonLogType = { calls: [], seedsGiven: [] };
  let baseDir: string | null = null;
  let walletFile: string | null = null;
  let chain = 'swarm-mainnet';
  let initialized = false;
  let proposalStored = false;
  let syncRunning = false;
  // SWARM addition (B6, 2026-09-29): like the real addon, the wallet file
  // holds the seed, so `get_seed` answers the phrase the wallet was restored
  // from - also after it is closed and opened again. Test phrases only.
  let seedPhrase: string | null = null;
  const SEED_LINE = 'seed ';

  const requireOpen = (name: string): void => {
    if (!initialized) {
      throw new Error('Error: Lightclient is not initialized');
    }
    log.calls.push(name);
  };

  const init = (name: string, chainHint: string, walletName: string) => {
    log.calls.push(name);
    if (baseDir == null) {
      throw new Error('wallet base directory was never set');
    }
    chain = chainHint.startsWith('swarm-mainnet')
      ? 'swarm-mainnet'
      : 'swarm-testnet';
    walletFile = join(baseDir, chain, walletName);
    initialized = true;
    return JSON.stringify({ seed_phrase: 'fake', birthday: 1 });
  };

  const addon = {
    set_wallet_base_dir(path: string): boolean {
      log.calls.push('set_wallet_base_dir');
      if (baseDir != null && baseDir !== path) {
        return false;
      }
      baseDir = path;
      return true;
    },
    set_crypto_default_provider_to_ring: () => 'OK',
    deinitialize(): string {
      log.calls.push('deinitialize');
      initialized = false;
      syncRunning = false;
      seedPhrase = null;
      return 'OK';
    },
    init_from_seed(
      seed: string,
      birthday: number,
      _server: string,
      chainHint: string,
      _performance: string,
      _minConfirmations: number,
      walletName: string
    ): string {
      // The seed is recorded as its word count only.
      log.seedsGiven.push(seed.split(/\s+/).length);
      log.calls.push(`birthday:${birthday}`);
      seedPhrase = seed;
      return init('init_from_seed', chainHint, walletName);
    },
    init_from_b64(
      _server: string,
      chainHint: string,
      _performance: string,
      _minConfirmations: number,
      walletName: string
    ): string {
      const answer = init('init_from_b64', chainHint, walletName);
      seedPhrase = null;
      if (walletFile != null && existsSync(walletFile)) {
        const line = readFileSync(walletFile, 'utf8')
          .split('\n')
          .find(text => text.startsWith(SEED_LINE));
        seedPhrase = line == null ? null : line.slice(SEED_LINE.length);
      }
      return answer;
    },
    // SWARM addition (0.1.4): swarm-wallet-core 0.3.0's move of a wallet file
    // written on the abandoned SWARM Mainnet chain. Like the real addon: SWARM
    // Mainnet only, a file that must exist, a byte-identical backup beside it,
    // and a report with no key material. The fake file keeps its seed line, as
    // the real move keeps the recovery phrase.
    move_wallet_to_restarted_chain(
      chainHint: string,
      _performance: string,
      _minConfirmations: number,
      walletName: string
    ): string {
      log.calls.push('move_wallet_to_restarted_chain');
      if (!chainHint.startsWith('swarm-mainnet:')) {
        throw new Error(
          'moving the wallet to the restarted SWARM network: only a SWARM Mainnet wallet is moved'
        );
      }
      if (baseDir == null) {
        throw new Error('wallet base directory was never set');
      }
      const file = join(baseDir, 'swarm-mainnet', walletName);
      if (!existsSync(file)) {
        throw new Error(
          `moving the wallet to the restarted SWARM network: there is no wallet file at ${file}`
        );
      }
      initialized = false;
      const original = readFileSync(file);
      const backup = `${file}.before-network-restart-1790970000.bak`;
      writeFileSync(backup, original);
      writeFileSync(
        file,
        original
          .toString('utf8')
          .replace(/^fake wallet bytes .*$/m, 'fake wallet bytes moved')
      );
      return JSON.stringify({
        backup_path: backup,
        previous_birthday: 6000,
        birthday: 1,
        key_kind: 'seed',
        unified_addresses: 1,
        transparent_addresses: 1,
        transparent_other_scopes: 0,
      });
    },
    async save_wallet_file(): Promise<string> {
      requireOpen('save_wallet_file');
      if (walletFile == null) {
        throw new Error('no wallet path');
      }
      mkdirSync(dirname(walletFile), { recursive: true });
      const bytes =
        `fake wallet bytes ${log.calls.length}` +
        (seedPhrase == null ? '' : `\n${SEED_LINE}${seedPhrase}`);
      writeFileSync(walletFile, bytes);
      return `Wallet saved successfully. Size: ${bytes.length} bytes.`;
    },
    async get_seed(): Promise<string> {
      requireOpen('get_seed');
      if (options.seedDelayMs != null) {
        await new Promise(resolve => setTimeout(resolve, options.seedDelayMs));
      }
      if (options.seedError != null) {
        throw new Error(options.seedError);
      }
      return JSON.stringify({
        seed_phrase:
          seedPhrase ?? Array.from({ length: 24 }, () => 'abandon').join(' '),
        birthday: 1,
        no_of_accounts: 1,
      });
    },
    async get_balance(): Promise<string> {
      requireOpen('get_balance');
      const spendable = options.spendable ?? 0;
      return JSON.stringify({
        confirmed_ironwood_balance: 0,
        unconfirmed_ironwood_balance: 0,
        total_ironwood_balance: 0,
        confirmed_orchard_balance: spendable,
        unconfirmed_orchard_balance: 25_000,
        total_orchard_balance: spendable + 25_000,
        confirmed_sapling_balance: 0,
        unconfirmed_sapling_balance: 0,
        total_sapling_balance: 0,
        confirmed_transparent_balance: 0,
        unconfirmed_transparent_balance: 0,
        total_transparent_balance: 0,
      });
    },
    async get_spendable_balance_total(): Promise<string> {
      requireOpen('get_spendable_balance_total');
      return JSON.stringify({ spendable_balance: options.spendable ?? 0 });
    },
    async get_unified_addresses(): Promise<string> {
      requireOpen('get_unified_addresses');
      return JSON.stringify([
        {
          account: 0,
          address_index: 0,
          has_orchard: true,
          has_sapling: true,
          has_transparent: false,
          encoded_address: FAKE_UNIFIED_ADDRESS,
        },
      ]);
    },
    async get_transparent_addresses(): Promise<string> {
      requireOpen('get_transparent_addresses');
      return JSON.stringify([]);
    },
    async get_value_transfers(): Promise<string> {
      requireOpen('get_value_transfers');
      if (options.valueTransfers != null) {
        return JSON.stringify({ value_transfers: options.valueTransfers });
      }
      // Oldest first, as the addon answers; one entry has a malformed txid.
      return JSON.stringify({
        value_transfers: [
          {
            txid: 'aa'.repeat(32),
            kind: 'received',
            value: 200_000_000,
            block_height: 42,
            datetime: 1_790_000_000,
            memo: 'for the coffee',
          },
          { txid: 'not-a-txid', kind: 'received', value: 1 },
          {
            txid: 'BB'.repeat(32),
            kind: 'sent',
            value: 50_000_000,
            fee: 10_000,
            block_height: null,
            memo: null,
          },
        ],
      });
    },
    async create_new_unified_address(receivers: string): Promise<string> {
      requireOpen('create_new_unified_address');
      log.calls.push(`receivers:${receivers}`);
      return JSON.stringify({
        account: 0,
        address_index: 1,
        has_orchard: receivers.includes('o'),
        has_sapling: receivers.includes('z'),
        has_transparent: false,
        encoded_address: options.newAddress ?? FAKE_UNIFIED_ADDRESS,
      });
    },
    async run_sync(): Promise<string> {
      requireOpen('run_sync');
      syncRunning = options.syncKeepsRunning === true;
      return 'Launching sync task...';
    },
    async poll_sync(): Promise<string> {
      requireOpen('poll_sync');
      if (syncRunning) {
        return 'Sync task is not complete.';
      }
      return JSON.stringify({ sync_complete: { scanned: 100 } });
    },
    async stop_sync(): Promise<string> {
      requireOpen('stop_sync');
      if (syncRunning) {
        syncRunning = false;
        return 'Stopping sync task...';
      }
      return 'Sync already stopped.';
    },
    async status_sync(): Promise<string> {
      requireOpen('status_sync');
      return JSON.stringify({
        scan_ranges: [
          { priority: 'Scanned', start_block: '1', end_block: '1438' },
        ],
        percentage_total_blocks_scanned: 100,
        total_blocks_scanned: 1438,
      });
    },
    async info_server(): Promise<string> {
      requireOpen('info_server');
      return JSON.stringify({
        chain_name: chain,
        latest_block_height: 1438,
        genesis_hash:
          chain === 'swarm-mainnet'
            ? SWARM_MAINNET_GENESIS
            : SWARM_TESTNET_PROFILE.genesis,
      });
    },
    async get_latest_block_server(server: string): Promise<string> {
      log.calls.push(`get_latest_block_server:${server}`);
      return '1438';
    },
    async parse_address(): Promise<string> {
      return JSON.stringify({ status: 'Invalid address' });
    },
    async send(): Promise<string> {
      requireOpen('send');
      if (options.sendError != null) {
        return JSON.stringify({ error: options.sendError });
      }
      proposalStored = true;
      return JSON.stringify({ fee: 10_000 });
    },
    async confirm(): Promise<string> {
      requireOpen('confirm');
      if (!proposalStored) {
        return JSON.stringify({ error: 'no proposal stored' });
      }
      proposalStored = false;
      return JSON.stringify({ txids: ['cc'.repeat(32)] });
    },
  };

  return { addon: addon as unknown as NativeAddon, log };
}
