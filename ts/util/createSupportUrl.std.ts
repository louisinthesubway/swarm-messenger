// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

// the support only provides a subset of languages available within the app
// so we have to list them out here and fallback to english if not included
const SUPPORT_LANGUAGES = [
  'ar',
  'bn',
  'de',
  'en-us',
  'es',
  'fr',
  'hi',
  'hi-in',
  'hc',
  'id',
  'it',
  'ja',
  'ko',
  'mr',
  'ms',
  'nl',
  'pl',
  'pt',
  'ru',
  'sv',
  'ta',
  'te',
  'tr',
  'uk',
  'ur',
  'vi',
  'zh-cn',
  'zh-tw',
];

export type CreateSupportUrlOptionsType = Readonly<{
  locale: string;
  query?: Record<string, string>;
}>;

export function createSupportUrl({
  locale,
  query = {},
}: CreateSupportUrlOptionsType): string {
  // SWARM change (M1): swarm.green/support is a single page - it does not have
  // Signal's per-language support paths, so the locale is passed as a query
  // parameter for whoever reads the request instead of going into the path.
  const language = SUPPORT_LANGUAGES.includes(locale) ? locale : 'en-us';

  const url = new URL('https://swarm.green/support');
  url.searchParams.set('lang', language);

  url.searchParams.set('desktop', '');

  for (const [key, value] of Object.entries(query)) {
    if (key === 'desktop') {
      continue;
    }
    url.searchParams.set(key, value);
  }

  // Support page requires `?desktop&...` not `?desktop=&...`
  return url.toString().replace('desktop=', 'desktop');
}
