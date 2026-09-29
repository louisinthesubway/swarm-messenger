// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { LocalizerType } from '../types/Util.std.ts';

export function getStringForPhoneNumberDiscovery({
  phoneNumber,
  i18n,
  conversationTitle,
  sharedGroup,
}: {
  phoneNumber: string;
  i18n: LocalizerType;
  conversationTitle: string;
  sharedGroup?: string;
}): string {
  // SWARM change (B4, 2026-09-29): with no number to show (a SWARM account
  // identifier is never shown), say whose chat it is without one.
  if (!phoneNumber) {
    if (sharedGroup) {
      return i18n(
        'icu:SwarmPhoneNumberDiscovery--notification--withSharedGroup',
        {
          conversationTitle,
          sharedGroup,
        }
      );
    }
    return i18n('icu:SwarmPhoneNumberDiscovery--notification--noSharedGroup', {
      conversationTitle,
    });
  }

  if (sharedGroup) {
    return i18n('icu:PhoneNumberDiscovery--notification--withSharedGroup', {
      phoneNumber,
      conversationTitle,
      sharedGroup,
    });
  }

  return i18n('icu:PhoneNumberDiscovery--notification--noSharedGroup', {
    phoneNumber,
    conversationTitle,
  });
}
