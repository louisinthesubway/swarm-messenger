// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ConversationType } from '../state/ducks/conversations.preload.ts';
import { PLACEHOLDER_CONTACT_ID } from '../state/selectors/conversations.dom.ts';
import { format, isValidNumber } from '../types/PhoneNumber.std.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { isSwarmIdentityE164 } from './swarm/swarmIdentityE164.std.ts';

const PLACEHOLDER_CONTACT: ConversationType = {
  acceptedMessageRequest: false,
  badges: [],
  id: PLACEHOLDER_CONTACT_ID,
  isMe: false,
  title: window.SignalContext.i18n('icu:unknownContact'),
  type: 'direct',
};

export function findAndFormatContact(identifier?: string): ConversationType {
  if (!identifier) {
    return PLACEHOLDER_CONTACT;
  }

  const contactModel = window.ConversationController.get(
    identifier.toLowerCase()
  );
  if (contactModel) {
    return contactModel.format();
  }

  const regionCode = itemStorage.get('regionCode');

  // SWARM change (B4, 2026-09-29): a SWARM account identifier is not a phone
  // number and is never shown as one.
  if (
    isSwarmIdentityE164(identifier) ||
    !isValidNumber(identifier, { regionCode })
  ) {
    return PLACEHOLDER_CONTACT;
  }

  const phoneNumber = format(identifier, { ourRegionCode: regionCode });

  return {
    acceptedMessageRequest: false,
    badges: [],
    id: 'phone-only',
    isMe: false,
    phoneNumber,
    title: phoneNumber,
    type: 'direct',
  };
}
