// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (M3 wave 2): the address exchange, as the conversation
// remembers it. What must hold: an address is kept per network; the newest
// message's address wins and a late older one does not replace it; the
// conversation's own address is remembered once made; notices are remembered
// once each, and neither list grows without bound; answering a request is
// remembered and an answer can change.

import { assert } from 'chai';

import {
  MAX_ANSWERED_REQUESTS,
  MAX_NOTICES_PER_CONVERSATION,
  ourSwarmAddress,
  reduceSwarmConversation,
  swarmRequestAnswer,
  theirSwarmAddress,
} from '../../util/swarm/swarmConversation.std.ts';
import type { SwarmConversationStateType } from '../../util/swarm/swarmConversation.std.ts';
import { bech32mAddress } from '../../test-helpers/swarmAddresses.std.ts';

const MAIN_A = bech32mAddress('swm', 1);
const MAIN_B = bech32mAddress('swm', 2);
const TEST_A = bech32mAddress('swarm', 1);

function theirs(
  state: SwarmConversationStateType | undefined,
  address: string,
  messageId: string,
  sentAt: number,
  chain: 'swarm-mainnet' | 'swarm-testnet' = 'swarm-mainnet'
): SwarmConversationStateType {
  return reduceSwarmConversation(state, {
    type: 'their-address-checked',
    chain,
    address,
    messageId,
    sentAt,
  });
}

describe('SWARM chat payments: the address exchange', () => {
  it('keeps the address a person shared, with the message it came from', () => {
    const state = theirs(undefined, MAIN_A, 'm1', 1000);
    assert.deepStrictEqual(theirSwarmAddress(state, 'swarm-mainnet'), {
      address: MAIN_A,
      messageId: 'm1',
      sentAt: 1000,
    });
  });

  it('keeps one address per network, never across them', () => {
    let state = theirs(undefined, MAIN_A, 'm1', 1000);
    state = theirs(state, TEST_A, 'm2', 2000, 'swarm-testnet');
    assert.strictEqual(
      theirSwarmAddress(state, 'swarm-mainnet')?.address,
      MAIN_A
    );
    assert.strictEqual(
      theirSwarmAddress(state, 'swarm-testnet')?.address,
      TEST_A
    );
  });

  it('lets a newer share replace an older one', () => {
    let state = theirs(undefined, MAIN_A, 'm1', 1000);
    state = theirs(state, MAIN_B, 'm2', 2000);
    assert.strictEqual(
      theirSwarmAddress(state, 'swarm-mainnet')?.messageId,
      'm2'
    );
  });

  it('does not let an older share, arriving late, replace a newer one', () => {
    let state = theirs(undefined, MAIN_B, 'm2', 2000);
    state = theirs(state, MAIN_A, 'm1', 1000);
    assert.deepStrictEqual(theirSwarmAddress(state, 'swarm-mainnet'), {
      address: MAIN_B,
      messageId: 'm2',
      sentAt: 2000,
    });
  });

  it('changes nothing when the same share is processed twice', () => {
    const state = theirs(undefined, MAIN_A, 'm1', 1000);
    assert.strictEqual(theirs(state, MAIN_A, 'm1', 1000), state);
  });

  it('remembers the address made for this conversation', () => {
    const state = reduceSwarmConversation(undefined, {
      type: 'our-address-created',
      chain: 'swarm-mainnet',
      address: MAIN_A,
      createdAt: 5,
    });
    assert.deepStrictEqual(ourSwarmAddress(state, 'swarm-mainnet'), {
      address: MAIN_A,
      createdAt: 5,
    });
    assert.isUndefined(ourSwarmAddress(state, 'swarm-testnet'));
  });

  it('remembers each notice once, and only the latest ones', () => {
    let state: SwarmConversationStateType | undefined;
    for (let i = 0; i < MAX_NOTICES_PER_CONVERSATION + 5; i += 1) {
      state = reduceSwarmConversation(state, {
        type: 'notice',
        chain: 'swarm-mainnet',
        txid: i.toString(16).padStart(64, '0'),
        direction: 'incoming',
        messageId: `m${i}`,
      });
    }
    const again = reduceSwarmConversation(state, {
      type: 'notice',
      chain: 'swarm-mainnet',
      txid: (MAX_NOTICES_PER_CONVERSATION + 4).toString(16).padStart(64, '0'),
      direction: 'incoming',
      messageId: 'another-message',
    });
    assert.strictEqual(again, state);
    const notices = state?.['swarm-mainnet']?.notices ?? [];
    assert.lengthOf(notices, MAX_NOTICES_PER_CONVERSATION);
    assert.strictEqual(notices[0]?.messageId, 'm5');
  });

  it('remembers how a request was answered, and lets the answer change', () => {
    let state = reduceSwarmConversation(undefined, {
      type: 'request-answered',
      chain: 'swarm-mainnet',
      messageId: 'r1',
      answer: 'ignored',
    });
    assert.strictEqual(
      swarmRequestAnswer(state, 'swarm-mainnet', 'r1'),
      'ignored'
    );
    state = reduceSwarmConversation(state, {
      type: 'request-answered',
      chain: 'swarm-mainnet',
      messageId: 'r1',
      answer: 'shared',
    });
    assert.strictEqual(
      swarmRequestAnswer(state, 'swarm-mainnet', 'r1'),
      'shared'
    );
    assert.isUndefined(swarmRequestAnswer(state, 'swarm-testnet', 'r1'));
  });

  it('keeps only the latest answered requests', () => {
    let state: SwarmConversationStateType | undefined;
    for (let i = 0; i < MAX_ANSWERED_REQUESTS + 3; i += 1) {
      state = reduceSwarmConversation(state, {
        type: 'request-answered',
        chain: 'swarm-mainnet',
        messageId: `r${i}`,
        answer: 'ignored',
      });
    }
    const answered = state?.['swarm-mainnet']?.answeredRequests ?? {};
    assert.lengthOf(Object.keys(answered), MAX_ANSWERED_REQUESTS);
    assert.isUndefined(answered.r0);
    assert.strictEqual(answered[`r${MAX_ANSWERED_REQUESTS + 2}`], 'ignored');
  });

  it('holds strings and numbers only, so it can be stored and put in redux', () => {
    let state = theirs(undefined, MAIN_A, 'm1', 1000);
    state = reduceSwarmConversation(state, {
      type: 'notice',
      chain: 'swarm-mainnet',
      txid: 'ab'.repeat(32),
      direction: 'outgoing',
      messageId: 'm2',
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(state)), state);
  });
});
