// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  ConversationAttributesType,
  ConversationRenderInfoType,
} from '../model-types.d.ts';
import { combineNames } from './combineNames.std.ts';
import { getRegionCodeForNumber } from './libphonenumberUtil.std.ts';
import { instance, PhoneNumberFormat } from './libphonenumberInstance.std.ts';
import { isDirectConversation } from './whatTypeOfConversation.dom.ts';
import { isConversationEverUnregistered } from './isConversationUnregistered.dom.ts';
import { getE164 } from './getE164.std.ts';
import { itemStorage } from '../textsecure/Storage.preload.ts';
import { isAciString } from './isAciString.std.ts';
import {
  isSwarmIdentityE164,
  shortSwarmAccountId,
} from './swarm/swarmIdentityE164.std.ts';

type TitleOptions = {
  isShort?: boolean;
  ignoreNickname?: boolean;
};

const { i18n } = window.SignalContext;

export function getTitle(
  attributes: ConversationRenderInfoType,
  options?: TitleOptions
): string {
  const title = getTitleNoDefault(attributes, options);
  if (title) {
    return title;
  }

  if (isDirectConversation(attributes)) {
    if (isConversationEverUnregistered(attributes)) {
      return i18n('icu:deletedAccount');
    }
    // SWARM change (B4, 2026-09-29): an account with no name and no username
    // is "SWARM account 1a2b" (the end of its ACI), never its synthetic number.
    return getSwarmAccountLabel(attributes) ?? i18n('icu:unknownContact');
  }
  return i18n('icu:unknownGroup');
}

export function getTitleNoDefault(
  attributes: ConversationRenderInfoType,
  { isShort = false, ignoreNickname = false }: TitleOptions = {}
): string | undefined {
  if (!isDirectConversation(attributes)) {
    return attributes.name;
  }

  const { username } = attributes;

  let nicknameValue: string | undefined;
  if (!ignoreNickname) {
    nicknameValue =
      (isShort ? attributes.nicknameGivenName : undefined) ||
      getNicknameName(attributes);
  }

  return (
    nicknameValue ||
    (isShort ? attributes.systemGivenName : undefined) ||
    getSystemName(attributes) ||
    (isShort ? attributes.profileName : undefined) ||
    getProfileName(attributes) ||
    getNumber(attributes) ||
    username ||
    // SWARM change (B4, 2026-09-29): where upstream's title was the phone
    // number and that number is a SWARM account identifier (which is never
    // shown), the neutral label takes its place, so the conversation still
    // counts as having a title (search, compose and forward lists keep it).
    (hasHiddenSwarmNumber(attributes)
      ? getSwarmAccountLabel(attributes)
      : undefined)
  );
}

/**
 * SWARM addition (B4, 2026-09-29): the one neutral name for a direct
 * conversation that has no nickname, contact name, profile name or username:
 * "SWARM account" and the last four hex characters of the account's ACI.
 * Undefined when the conversation has no ACI to take them from.
 */
export function getSwarmAccountLabel(
  attributes: Pick<ConversationAttributesType, 'serviceId'>
): string | undefined {
  const { serviceId } = attributes;
  const shortId = isAciString(serviceId)
    ? shortSwarmAccountId(serviceId)
    : undefined;
  if (!shortId) {
    return undefined;
  }
  return i18n('icu:SwarmAccount--fallback-title', { shortId });
}

/**
 * SWARM addition (B4, 2026-09-29): whether upstream would have titled this
 * conversation with its phone number, where that number is a SWARM account
 * identifier and so is not shown.
 */
function hasHiddenSwarmNumber(
  attributes: Pick<
    ConversationAttributesType,
    'e164' | 'type' | 'sharingPhoneNumber' | 'profileKey'
  >
): boolean {
  return (
    isDirectConversation(attributes) && isSwarmIdentityE164(getE164(attributes))
  );
}

// Note that the used attributes field should match the ones we listen for
// change on in ConversationModel (see `ConversationModel#maybeClearUsername`)
export function canHaveUsername(
  attributes: Pick<
    ConversationAttributesType,
    | 'id'
    | 'type'
    | 'name'
    | 'profileName'
    | 'profileFamilyName'
    | 'e164'
    | 'systemGivenName'
    | 'systemFamilyName'
    | 'systemNickname'
    | 'nicknameGivenName'
    | 'nicknameFamilyName'
  >,
  ourConversationId: string | undefined
): boolean {
  if (!isDirectConversation(attributes)) {
    return false;
  }

  if (ourConversationId === attributes.id) {
    return true;
  }

  // SWARM change (B4, 2026-09-29): `hasNumber`, not `getNumber`: hiding a SWARM
  // identifier changes what is shown, not which usernames are kept (and so
  // not what goes into a storage-service contact record).
  return (
    !getNicknameName(attributes) &&
    !getSystemName(attributes) &&
    !getProfileName(attributes) &&
    !hasNumber(attributes)
  );
}

export function getProfileName(
  attributes: Pick<
    ConversationAttributesType,
    'profileName' | 'profileFamilyName' | 'type'
  >
): string | undefined {
  if (isDirectConversation(attributes)) {
    return combineNames(attributes.profileName, attributes.profileFamilyName);
  }

  return undefined;
}

function getNicknameName(
  attributes: Pick<
    ConversationAttributesType,
    'nicknameGivenName' | 'nicknameFamilyName' | 'type'
  >
): string | undefined {
  if (isDirectConversation(attributes)) {
    return combineNames(
      attributes.nicknameGivenName ?? undefined,
      attributes.nicknameFamilyName ?? undefined
    );
  }
  return undefined;
}

function getSystemName(
  attributes: Pick<
    ConversationAttributesType,
    'systemGivenName' | 'systemFamilyName' | 'systemNickname' | 'type'
  >
): string | undefined {
  if (isDirectConversation(attributes)) {
    return (
      attributes.systemNickname ||
      combineNames(attributes.systemGivenName, attributes.systemFamilyName)
    );
  }

  return undefined;
}

export function getNumber(
  attributes: Pick<
    ConversationAttributesType,
    'e164' | 'type' | 'sharingPhoneNumber' | 'profileKey'
  >
): string | undefined {
  if (!isDirectConversation(attributes)) {
    return '';
  }

  const e164 = getE164(attributes);
  if (!e164) {
    return '';
  }

  return renderNumber(e164);
}

export function renderNumber(e164: string): string | undefined {
  // SWARM change (B4, 2026-09-29): the synthetic account identifier a wallet
  // sign-in derives looks like a phone number and is not one. Every screen that
  // shows a person's number gets it from here (as `phoneNumber`, or through the
  // title), so this is where it stops being shown.
  if (isSwarmIdentityE164(e164)) {
    return undefined;
  }
  return formatNumber(e164);
}

/**
 * SWARM addition (B4, 2026-09-29): whether the conversation has a number
 * upstream would render, shown or not. For the checks that decide data
 * (usernames kept, title-transition notices), which must not move because the
 * number is hidden.
 */
function hasNumber(
  attributes: Pick<
    ConversationAttributesType,
    'e164' | 'type' | 'sharingPhoneNumber' | 'profileKey'
  >
): boolean {
  if (!isDirectConversation(attributes)) {
    return false;
  }
  const e164 = getE164(attributes);
  return Boolean(e164 && formatNumber(e164));
}

function formatNumber(e164: string): string | undefined {
  try {
    const parsedNumber = instance.parse(e164);
    const regionCode = getRegionCodeForNumber(e164);
    if (regionCode === itemStorage.get('regionCode')) {
      return instance.format(parsedNumber, PhoneNumberFormat.NATIONAL);
    }
    return instance.format(parsedNumber, PhoneNumberFormat.INTERNATIONAL);
  } catch (e) {
    return undefined;
  }
}

export function hasNumberTitle(
  attributes: Pick<
    ConversationAttributesType,
    'e164' | 'type' | 'sharingPhoneNumber' | 'profileKey'
  >
): boolean {
  // SWARM change (B4, 2026-09-29): `hasNumber`, see canHaveUsername.
  return (
    !getNicknameName(attributes) &&
    !getSystemName(attributes) &&
    !getProfileName(attributes) &&
    hasNumber(attributes)
  );
}

export function hasUsernameTitle(
  attributes: Pick<
    ConversationAttributesType,
    'e164' | 'type' | 'sharingPhoneNumber' | 'profileKey' | 'username'
  >
): boolean {
  // SWARM change (B4, 2026-09-29): `hasNumber`, see canHaveUsername.
  return (
    !getNicknameName(attributes) &&
    !getSystemName(attributes) &&
    !getProfileName(attributes) &&
    !hasNumber(attributes) &&
    Boolean(attributes.username)
  );
}
