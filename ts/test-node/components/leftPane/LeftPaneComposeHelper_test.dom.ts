// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import * as sinon from 'sinon';
import {
  RowType,
  _testHeaderText,
} from '../../../components/ConversationList.dom.tsx';
import { FindDirection } from '../../../components/leftPane/LeftPaneHelper.dom.tsx';
import {
  getDefaultConversation,
  getDefaultGroupListItem,
} from '../../../test-helpers/getDefaultConversation.std.ts';

import { LeftPaneComposeHelper } from '../../../components/leftPane/LeftPaneComposeHelper.dom.tsx';

// SWARM change (B4, 2026-09-29): SWARM accounts have no phone number, so the
// composer has no "Find by phone number" button and never offers typed digits
// as a number to start a chat with. The expectations below are upstream's with
// those rows taken out; the tests that were about them now check they are gone.

describe('LeftPaneComposeHelper', () => {
  let sinonSandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sinonSandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sinonSandbox.restore();
  });

  describe('getBackAction', () => {
    it('returns the "show inbox" action', () => {
      const showInbox = sinon.fake();
      const helper = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '',
        uuidFetchState: {},
        username: undefined,
      });

      assert.strictEqual(helper.getBackAction({ showInbox }), showInbox);
    });
  });

  describe('getRowCount', () => {
    it('returns 2 (for the "new group", etc) if not searching and there are no contacts', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '',
          username: undefined,
          uuidFetchState: {},
        }).getRowCount(),
        2
      );
    });

    it('returns the number of contacts + 3 (for the "new group"+etc and header) if not searching', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        5
      );
    });

    it('returns the number of contacts + number of groups + 4 (for the "new group"+etc and the headers) if not searching', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: '',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        8
      );
    });

    it('returns two if the search term looks like a username', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: 'someone.01',
          uuidFetchState: {},
          username: 'someone.01',
        }).getRowCount(),
        2,
        'ends with discriminator'
      );
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: '@someone',
          uuidFetchState: {},
          username: 'someone',
        }).getRowCount(),
        2,
        'starts with @'
      );
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: '23432',
          uuidFetchState: {},
          username: '23432',
        }).getRowCount(),
        8,
        "all numbers, so it doesn't look like a username"
      );
    });

    it('returns the number of contacts, number groups + 4 (for headers and username)', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: 'someone',
          uuidFetchState: {},
          username: 'someone',
        }).getRowCount(),
        8
      );
    });

    it('returns the number of conversations + the headers, but not for a phone number', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '5550101',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        0
      );
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '5550101',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        3
      );
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: '5550101',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        5
      );
    });

    it('returns 0 (no "Start new conversation" button) if searching for a phone number with no contacts', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '+16505551234',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        0
      );
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '+88810866442360',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        0,
        'a SWARM account identifier is not offered either'
      );
    });

    it('returns 2 if just username in results', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: 'someone',
          uuidFetchState: {},
          username: 'someone',
        }).getRowCount(),
        2
      );
    });

    it('returns the number of contacts + 1 (for the header, no "Start new conversation") if searching for a phone number', () => {
      assert.strictEqual(
        new LeftPaneComposeHelper({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '+16505551234',
          uuidFetchState: {},
          username: undefined,
        }).getRowCount(),
        3
      );
    });
  });

  describe('getRow', () => {
    it('returns a "new group"+etc if not searching and there are no contacts', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '',
        uuidFetchState: {},
        username: undefined,
      });

      assert.deepEqual(helper.getRow(0), {
        type: RowType.CreateNewGroup,
      });
      assert.deepEqual(helper.getRow(1), {
        type: RowType.FindByUsername,
      });
      assert.isUndefined(helper.getRow(2));
    });

    it('returns a "new group"+etc, a header, and contacts if not searching', () => {
      const composeContacts = [
        getDefaultConversation(),
        getDefaultConversation(),
      ] as const;
      const helper = new LeftPaneComposeHelper({
        composeContacts,
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '',
        uuidFetchState: {},
        username: undefined,
      });

      assert.deepEqual(helper.getRow(0), {
        type: RowType.CreateNewGroup,
      });
      assert.deepEqual(helper.getRow(1), {
        type: RowType.FindByUsername,
      });
      assert.deepEqual(_testHeaderText(helper.getRow(2)), 'icu:contactsHeader');
      assert.deepEqual(helper.getRow(3), {
        type: RowType.Contact,
        contact: composeContacts[0],
        hasContextMenu: true,
      });
      assert.deepEqual(helper.getRow(4), {
        type: RowType.Contact,
        contact: composeContacts[1],
        hasContextMenu: true,
      });
    });

    it('returns a "new group"+etc, a header, contacts, groups header, and groups -- if not searching', () => {
      const composeContacts = [
        getDefaultConversation(),
        getDefaultConversation(),
      ] as const;
      const composeGroups = [
        getDefaultGroupListItem(),
        getDefaultGroupListItem(),
      ] as const;
      const helper = new LeftPaneComposeHelper({
        composeContacts,
        composeGroups,
        regionCode: 'US',
        searchTerm: '',
        uuidFetchState: {},
        username: undefined,
      });

      assert.deepEqual(helper.getRow(0), {
        type: RowType.CreateNewGroup,
      });
      assert.deepEqual(helper.getRow(1), {
        type: RowType.FindByUsername,
      });
      assert.deepEqual(_testHeaderText(helper.getRow(2)), 'icu:contactsHeader');
      assert.deepEqual(helper.getRow(3), {
        type: RowType.Contact,
        contact: composeContacts[0],
        hasContextMenu: true,
      });
      assert.deepEqual(helper.getRow(4), {
        type: RowType.Contact,
        contact: composeContacts[1],
        hasContextMenu: true,
      });
      assert.deepEqual(_testHeaderText(helper.getRow(5)), 'icu:groupsHeader');
      assert.deepEqual(helper.getRow(6), {
        type: RowType.SelectSingleGroup,
        group: composeGroups[0],
      });
      assert.deepEqual(helper.getRow(7), {
        type: RowType.SelectSingleGroup,
        group: composeGroups[1],
      });
      assert.isUndefined(helper.getRow(8));
    });

    it('returns one row per contact if searching', () => {
      const composeContacts = [
        getDefaultConversation(),
        getDefaultConversation(),
      ] as const;
      const helper = new LeftPaneComposeHelper({
        composeContacts,
        composeGroups: [],
        regionCode: 'US',
        searchTerm: 'foo bar',
        uuidFetchState: {},
        username: undefined,
      });

      assert.deepEqual(helper.getRow(1), {
        type: RowType.Contact,
        contact: composeContacts[0],
        hasContextMenu: true,
      });
      assert.deepEqual(helper.getRow(2), {
        type: RowType.Contact,
        contact: composeContacts[1],
        hasContextMenu: true,
      });
    });

    it('returns no "start new conversation" row if searching for a phone number and there are no results', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '+1(650) 555 12 34',
        uuidFetchState: {},
        username: undefined,
      });

      assert.isUndefined(helper.getRow(0));
    });

    it('returns just a "find by username" header if no results', () => {
      const username = 'someone.02';

      const helper = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: username,
        username,
        uuidFetchState: {
          [`username:${username}`]: true,
        },
      });

      assert.deepEqual(
        _testHeaderText(helper.getRow(0)),
        'icu:findByUsernameHeader'
      );
      assert.deepEqual(helper.getRow(1), {
        type: RowType.UsernameSearchResult,
        username,
        isFetchingUsername: true,
      });
      assert.isUndefined(helper.getRow(2));
    });

    it('returns a header and contacts, but no "start new conversation" row, if searching for a phone number', () => {
      const composeContacts = [
        getDefaultConversation(),
        getDefaultConversation(),
      ] as const;
      const helper = new LeftPaneComposeHelper({
        composeContacts,
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '+1(650) 555 12 34',
        username: undefined,
        uuidFetchState: {},
      });

      assert.deepEqual(_testHeaderText(helper.getRow(0)), 'icu:contactsHeader');
      assert.deepEqual(helper.getRow(1), {
        type: RowType.Contact,
        contact: composeContacts[0],
        hasContextMenu: true,
      });
      assert.deepEqual(helper.getRow(2), {
        type: RowType.Contact,
        contact: composeContacts[1],
        hasContextMenu: true,
      });
      assert.isUndefined(helper.getRow(3));
    });
  });

  describe('getConversationAndMessageAtIndex', () => {
    it('returns undefined because keyboard shortcuts are not supported', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: 'foo bar',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isUndefined(helper.getConversationAndMessageAtIndex(0));
    });
  });

  describe('getConversationAndMessageInDirection', () => {
    it('returns undefined because keyboard shortcuts are not supported', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: 'foo bar',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isUndefined(
        helper.getConversationAndMessageInDirection(
          { direction: FindDirection.Down, unreadOnly: false },
          undefined,
          undefined
        )
      );
    });
  });

  describe('shouldRecomputeRowHeights', () => {
    it('returns false if just search changes, so "Find by username" header is in same position', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: 'foo bar',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isFalse(
        helper.shouldRecomputeRowHeights({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: 'different search',
          username: undefined,
          uuidFetchState: {},
        })
      );
      assert.isFalse(
        helper.shouldRecomputeRowHeights({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: 'last search',
          username: undefined,
          uuidFetchState: {},
        })
      );
    });

    it('returns true if "Find by usernames" header changes location or goes away', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isFalse(
        helper.shouldRecomputeRowHeights({
          composeContacts: [getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '',
          username: undefined,
          uuidFetchState: {},
        })
      );
    });

    it('returns true if search changes, and not when it becomes an e164', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: 'foo bar',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isTrue(
        helper.shouldRecomputeRowHeights({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '',
          username: undefined,
          uuidFetchState: {},
        })
      );
      // No phone-number section appears, so no header moves.
      assert.isFalse(
        helper.shouldRecomputeRowHeights({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: '+16505551234',
          username: undefined,
          uuidFetchState: {},
        })
      );
    });

    it('returns true if going from no search to some search (showing "Find by username" section)', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isTrue(
        helper.shouldRecomputeRowHeights({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: 'foo bar',
          username: undefined,
          uuidFetchState: {},
        })
      );
    });

    it('should be true if going from contact to group or vice versa', () => {
      const helperContacts = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: 'foo bar',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isTrue(
        helperContacts.shouldRecomputeRowHeights({
          composeContacts: [],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: 'foo bar',
          username: undefined,
          uuidFetchState: {},
        })
      );

      const helperGroups = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
        regionCode: 'US',
        searchTerm: 'foo bar',
        username: undefined,
        uuidFetchState: {},
      });

      assert.isTrue(
        helperGroups.shouldRecomputeRowHeights({
          composeContacts: [getDefaultConversation(), getDefaultConversation()],
          composeGroups: [],
          regionCode: 'US',
          searchTerm: 'foo bar',
          username: undefined,
          uuidFetchState: {},
        })
      );
    });

    it('should be true if the headers are in different row indices as before', () => {
      const helperContacts = new LeftPaneComposeHelper({
        composeContacts: [getDefaultConversation(), getDefaultConversation()],
        composeGroups: [getDefaultGroupListItem()],
        regionCode: 'US',
        searchTerm: 'soup',
        username: 'soup',
        uuidFetchState: {},
      });

      assert.isTrue(
        helperContacts.shouldRecomputeRowHeights({
          composeContacts: [getDefaultConversation()],
          composeGroups: [getDefaultGroupListItem(), getDefaultGroupListItem()],
          regionCode: 'US',
          searchTerm: 'soup',
          username: 'soup',
          uuidFetchState: {},
        })
      );
    });
  });
});
