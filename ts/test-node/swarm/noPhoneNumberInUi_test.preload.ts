// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B4, 2026-09-29): no phone number in the interface. A SWARM
// account's synthetic `+888...` identifier stays in the data, and every path
// that turns it into text for a screen gives nothing instead. What must hold:
// - the central formatter (`renderNumber`, and `getNumber` built on it, which
//   is where every screen's `phoneNumber` comes from) gives nothing for it,
//   and still formats a real number as upstream does;
// - a title never falls back to it: a name, then the username, then the one
//   neutral label ("SWARM account" and the end of the ACI);
// - a contact titled that way still counts as having a title (search, compose
//   and forward lists keep it);
// - the checks that decide data (which usernames are kept) do not move;
// - the phone-number discovery notice words itself without a number;
// - the composer offers no "Find by phone number" and no number to start a
//   chat with.

import { assert } from 'chai';

import type { ConversationAttributesType } from '../../model-types.d.ts';
import type { AciString } from '../../types/ServiceId.std.ts';
import {
  canHaveUsername,
  getNumber,
  getSwarmAccountLabel,
  getTitle,
  getTitleNoDefault,
  hasNumberTitle,
  renderNumber,
} from '../../util/getTitle.preload.ts';
import { getStringForPhoneNumberDiscovery } from '../../util/getStringForPhoneNumberDiscovery.std.ts';
import { LeftPaneComposeHelper } from '../../components/leftPane/LeftPaneComposeHelper.dom.tsx';
import { RowType } from '../../components/ConversationList.dom.tsx';
import type { LocalizerType } from '../../types/Util.std.ts';

const SWARM_E164 = '+88810866442360';
const REAL_E164 = '+16505551234';
const ACI = '8c78cd2a-16ff-427d-83dc-1a5e36ce713d' as AciString;

const LABEL_KEY = 'i18n(icu:SwarmAccount--fallback-title)';

function contact(
  props: Partial<ConversationAttributesType>
): ConversationAttributesType {
  return {
    id: 'conversation-id',
    type: 'private',
    version: 2,
    ...props,
  } as ConversationAttributesType;
}

function assertNoIdentifier(text: string | undefined, what: string): void {
  assert.notInclude(text ?? '', '888', what);
  assert.notInclude(text ?? '', '10866442360', what);
}

describe('SWARM: no phone number in the interface', () => {
  describe('the central number formatter', () => {
    it('gives nothing for a SWARM account identifier', () => {
      assert.isUndefined(renderNumber(SWARM_E164));
      assert.notOk(getNumber(contact({ e164: SWARM_E164, serviceId: ACI })));
    });

    it('still formats a real number', () => {
      assert.include(renderNumber(REAL_E164) ?? '', '650');
    });
  });

  describe('titles', () => {
    it('are the neutral label, not the identifier, for an unnamed account', () => {
      const unnamed = contact({ e164: SWARM_E164, serviceId: ACI });
      assert.strictEqual(getTitle(unnamed), LABEL_KEY);
      assert.strictEqual(getTitle(unnamed, { isShort: true }), LABEL_KEY);
      assertNoIdentifier(getTitle(unnamed), 'title');
    });

    it('keep the label as a title, so the contact is still listed', () => {
      assert.strictEqual(
        getTitleNoDefault(contact({ e164: SWARM_E164, serviceId: ACI })),
        LABEL_KEY
      );
    });

    it('prefer a name, then the username, to the label', () => {
      assert.strictEqual(
        getTitle(
          contact({ e164: SWARM_E164, serviceId: ACI, profileName: 'Ada' })
        ),
        'Ada'
      );
      assert.strictEqual(
        getTitle(
          contact({ e164: SWARM_E164, serviceId: ACI, username: 'ada.42' })
        ),
        'ada.42'
      );
    });

    it('use the label, not "Unknown contact", for any account with an ACI', () => {
      assert.strictEqual(getTitle(contact({ serviceId: ACI })), LABEL_KEY);
      assert.isUndefined(getTitleNoDefault(contact({ serviceId: ACI })));
    });

    it('have no label without an ACI to shorten', () => {
      assert.isUndefined(
        getSwarmAccountLabel({
          serviceId: 'PNI:8c78cd2a-16ff-427d-83dc-1a5e36ce713d' as AciString,
        })
      );
    });

    it('still show a real number as upstream does', () => {
      assert.include(
        getTitle(contact({ e164: REAL_E164, serviceId: ACI })),
        '650'
      );
    });
  });

  describe('what decides data', () => {
    it('does not move because the number is hidden', () => {
      const withIdentifier = contact({ e164: SWARM_E164, serviceId: ACI });
      // As upstream: a contact with a number keeps no username, and its
      // title counts as a number title (for the title-transition notice).
      assert.isFalse(canHaveUsername(withIdentifier, 'our-conversation-id'));
      assert.isTrue(hasNumberTitle(withIdentifier));
    });
  });

  describe('the phone-number discovery notice', () => {
    it('names no number', () => {
      const i18n = ((key: string) => key) as unknown as LocalizerType;
      assert.strictEqual(
        getStringForPhoneNumberDiscovery({
          phoneNumber: '',
          i18n,
          conversationTitle: 'Ada',
        }),
        'icu:SwarmPhoneNumberDiscovery--notification--noSharedGroup'
      );
      assert.strictEqual(
        getStringForPhoneNumberDiscovery({
          phoneNumber: '',
          i18n,
          conversationTitle: 'Ada',
          sharedGroup: 'Friends',
        }),
        'icu:SwarmPhoneNumberDiscovery--notification--withSharedGroup'
      );
    });
  });

  describe('the composer', () => {
    it('has no "Find by phone number" button', () => {
      const helper = new LeftPaneComposeHelper({
        composeContacts: [],
        composeGroups: [],
        regionCode: 'US',
        searchTerm: '',
        uuidFetchState: {},
        username: undefined,
      });
      const rows = Array.from({ length: helper.getRowCount() }, (_, index) =>
        helper.getRow(index)
      );
      assert.deepEqual(
        rows.map(row => row?.type),
        [RowType.CreateNewGroup, RowType.FindByUsername]
      );
    });

    it('offers no number to start a chat with', () => {
      for (const searchTerm of [REAL_E164, SWARM_E164, '5550101']) {
        const helper = new LeftPaneComposeHelper({
          composeContacts: [],
          composeGroups: [],
          regionCode: 'US',
          searchTerm,
          uuidFetchState: {},
          username: undefined,
        });
        assert.strictEqual(helper.getRowCount(), 0, searchTerm);
      }
    });
  });
});
