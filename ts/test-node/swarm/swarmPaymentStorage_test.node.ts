// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): a SWARM payment notice and an address message
// are stored with the message exactly as upstream stores its payment events,
// so they must come back from the database after the app is closed and opened
// again - here, a database file closed and reopened. No new column and no
// migration: the event lives in the message's JSON.

import { assert } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cwd } from 'node:process';

import SQL from '@signalapp/sqlcipher';

import type { WritableDB } from '../../sql/Interface.std.ts';
import { DataReader, DataWriter, setupTests } from '../../sql/Server.node.ts';
import type { MessageAttributesType } from '../../model-types.d.ts';
import { PaymentEventKind } from '../../types/Payment.std.ts';
import type { SwarmPaymentEvent } from '../../types/Payment.std.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const OUR_ACI = generateAci();

function open(path: string): WritableDB {
  const db = new SQL(path) as WritableDB;
  db.initTokenizer();
  setupTests(db, { userDataPath: cwd() });
  return db;
}

function message(
  id: string,
  payment: SwarmPaymentEvent,
  type: 'incoming' | 'outgoing'
): MessageAttributesType {
  return {
    id,
    conversationId: 'conversation-1',
    type,
    sent_at: 1_790_000_000_000,
    received_at: 1,
    received_at_ms: 1_790_000_000_500,
    timestamp: 1_790_000_000_000,
    payment,
  };
}

describe('SWARM chat payments: storage', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'swarm-payment-storage-'));
    path = join(dir, 'db.sqlite');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps a notice, a request and a share across a restart', () => {
    const notice: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmNotification,
      txid: '7a'.repeat(32),
      amountZat: '2100000000000000',
      memoHash: '0f'.repeat(32),
      chain: 'swarm-mainnet',
      senderAddress: bech32mAddress('swm', 4),
      note: null,
    };
    const request: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmAddressRequest,
      chain: 'swarm-mainnet',
    };
    const share: SwarmPaymentEvent = {
      kind: PaymentEventKind.SwarmAddressShare,
      chain: 'swarm-testnet',
      address: bech32mAddress('swarm', 4),
    };

    const before = open(path);
    DataWriter.saveMessage(before, message('m-notice', notice, 'incoming'), {
      forceSave: true,
      ourAci: OUR_ACI,
    });
    DataWriter.saveMessage(before, message('m-request', request, 'outgoing'), {
      forceSave: true,
      ourAci: OUR_ACI,
    });
    DataWriter.saveMessage(before, message('m-share', share, 'incoming'), {
      forceSave: true,
      ourAci: OUR_ACI,
    });
    before.close();

    const after = open(path);
    try {
      assert.deepStrictEqual(
        DataReader.getMessageById(after, 'm-notice')?.payment,
        notice
      );
      assert.deepStrictEqual(
        DataReader.getMessageById(after, 'm-request')?.payment,
        request
      );
      assert.deepStrictEqual(
        DataReader.getMessageById(after, 'm-share')?.payment,
        share
      );
    } finally {
      after.close();
    }
  });
});
