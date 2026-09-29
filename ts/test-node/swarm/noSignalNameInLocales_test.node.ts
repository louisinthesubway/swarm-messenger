// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B1). The owner's rule: no user-visible string, in any language,
// names Signal. The one exception is the AGPL attribution, which must name it.
//
// Upstream translations bring the name back in many shapes: "Signal" as a word,
// with case endings written straight onto it (Finnish "Signalin", Hungarian
// "Signalt", Croatian "Signala"), with a diacritic (Czech "Signál", Latvian
// "Signālā"), in a native script (Arabic "سيجنال", Tamil "சிக்னல்", Cyrillic
// "Сигнал"), or with a look-alike Cyrillic letter (Serbian "Signаl"). This test
// knows every shape found in the 67 translations before the rebrand, so the next
// string import fails here instead of reaching a package.

import { assert } from 'chai';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

// The attribution strings (owned by the About/metadata work): the only strings
// allowed to name Signal.
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'icu:signalNonProfit',
  'icu:SwarmAbout__attribution',
]);

// Endings that a language writes straight onto the name. An ending joined with
// a hyphen or an apostrophe ("Signal-ın", "Signal'in") or a particle in another
// script ("Signalは", "Signal을") needs no entry: the name is still a Latin word
// of its own there. Each list is the language's case paradigm for a foreign
// name, which covers every ending found in the old translations. Languages
// without a list only match the bare word, so French "Signaler" (to report) or
// Swedish "ringsignal" (ring tone) are not the name.
const words = (list: string): ReadonlyArray<string> => list.split(' ');
const FINNISH = words(
  'in ia iä iin issa issä ista istä ille illa illä ilta iltä iksi ina inä itta ittä'
);
const ESTONIAN = words('i it is ist isse ile il ilt iga iks ini ina ita');
const HUNGARIAN = words(
  't ot nak nek on en ban ben ba be ból ből tól től hoz hez ra re ról ről nál nél lal lel ért ig ként'
);
const SOUTH_SLAVIC = words(
  'a u e om em ovi ovim ovima ovom ovem ove ova ovog ovega ov ovu ovo ovih ovemu nog nom ni na no ne'
);
const WEST_SLAVIC = words('a u e em om ovi ového ovým');
const SCANDINAVIAN = words('s en et ens ets');
const ENDINGS: Record<string, ReadonlyArray<string>> = {
  'af-ZA': ['s'],
  'bs-BA': SOUTH_SLAVIC,
  cs: WEST_SLAVIC,
  da: SCANDINAVIAN,
  de: ['s'],
  'et-EE': ESTONIAN,
  eu: words('en ek eko etik ekin ean ari i'),
  fi: FINNISH,
  'hr-HR': SOUTH_SLAVIC,
  hu: HUNGARIAN,
  'lt-LT': words('o ui u e as'),
  'lv-LV': words('a u am ā'),
  nb: SCANDINAVIAN,
  nl: ['s'],
  pl: words('a u em ie owi'),
  'sk-SK': WEST_SLAVIC,
  'sl-SI': SOUTH_SLAVIC,
  'sq-AL': words('i in it ë ut'),
  sv: SCANDINAVIAN,
};

// Cyrillic letters that look like Latin ones ("Signаl" with a Cyrillic а).
const LOOK_ALIKES: Record<string, string> = {
  а: 'a',
  А: 'A',
  і: 'i',
  І: 'I',
  ѕ: 's',
  Ѕ: 'S',
  ӏ: 'l',
  Ӏ: 'l',
};
const LOOK_ALIKE_RE = new RegExp(
  `[${Object.keys(LOOK_ALIKES).join('')}]`,
  'gu'
);

// The name written in other scripts, and Latin spellings with a diacritic.
// Stems without the last letter where endings are joined on (Tamil சிக்னல் ->
// சிக்னலை). Cyrillic and the diacritic spellings are matched capitalised only:
// lower-case "сигнал", "signál", "signāls" are ordinary words (Russian
// "звуковой сигнал" = beep, Latvian "zvana signālu" = ringing tone).
const OTHER_SPELLINGS: ReadonlyArray<RegExp> = [
  /سيجنال/u, // Arabic
  /سیگنال/u, // Persian
  /سگنل/u, // Urdu
  /سىگنال/u, // Uyghur
  /সিগন্যাল/u, // Bengali
  /સિગ્નલ/u, // Gujarati
  /सिग्नल/u, // Marathi, Hindi
  /சிக்னல/u, // Tamil
  /సిగ్నల/u, // Telugu
  /ಸಿಗ್ನಲ/u, // Kannada
  /സിഗ്നൽ|സിഗ്നല/u, // Malayalam
  /სიგნალ/u, // Georgian
  /シグナル/u, // Japanese
  /시그널/u, // Korean
  /(?<!\p{L})Сигнал/u, // Bulgarian, Kyrgyz, Serbian
  /(?<!\p{Script=Latin})Sign[áā]l/u, // Czech and Slovak "Signál", Latvian "Signālā"
];

function latinNameRe(locale: string): RegExp {
  const endings = ENDINGS[locale] ?? [];
  const ending = endings.length > 0 ? `(?:${endings.join('|')})?` : '';
  return new RegExp(
    `(?<![\\p{Script=Latin}\\p{N}_])signal${ending}(?![\\p{Script=Latin}\\p{N}_])`,
    'iu'
  );
}

function findSignalName(locale: string, text: string): string | undefined {
  const normalized = text.replace(LOOK_ALIKE_RE, ch => LOOK_ALIKES[ch] ?? ch);
  const latin = latinNameRe(locale).exec(normalized);
  if (latin) {
    return text.slice(latin.index, latin.index + latin[0].length);
  }
  for (const pattern of OTHER_SPELLINGS) {
    const match = pattern.exec(text);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

// Every offence starts with its locale; the summary counts them per locale.
function report(offences: ReadonlyArray<string>): string {
  const perLocale = new Map<string, number>();
  for (const offence of offences) {
    const locale = offence.slice(0, offence.indexOf(' '));
    perLocale.set(locale, (perLocale.get(locale) ?? 0) + 1);
  }
  const counts = [...perLocale]
    .map(([locale, count]) => `${locale} ${count}`)
    .join(', ');
  const shown = offences.slice(0, 40).join('\n');
  const more =
    offences.length > 40 ? `\n... and ${offences.length - 40} more` : '';
  return (
    `${offences.length} user-visible string(s) name Signal (${counts}):\n` +
    `${shown}${more}`
  );
}

// build/SignalStrings.nsh groups its strings under "# de_DE"-style comments;
// the generator (scripts/gen-nsis-script.mjs) reads _locales/de, zh_TW reads
// zh-Hant.
function nsisLocale(lang: string, locales: ReadonlyArray<string>): string {
  if (lang === 'zh_TW') {
    return 'zh-Hant';
  }
  const folder = lang.replace(/_/g, '-');
  if (locales.includes(folder)) {
    return folder;
  }
  return folder.replace(/-.*/, '');
}

describe('SWARM: no language names Signal', () => {
  const locales = readdirSync(join(ROOT, '_locales')).sort();

  it('knows the shapes the name took in the old translations', () => {
    const named: ReadonlyArray<[string, string]> = [
      ['de', 'Signal konnte nicht aktualisiert werden.'],
      ['fr', 'Bienvenue sur Signal'],
      ['fi', 'Lahjoita Signalille'],
      ['fi', 'Signalin työpöytäsovellus'],
      ['et-EE', 'Tere tulemast Signalisse'],
      ['hu', 'Támogasd a Signalt'],
      ['hr-HR', 'Nova verzija Signala'],
      ['sk-SK', 'hovory v Signale'],
      ['sv', 'Signals säkra lagringstjänst'],
      ['tr', "Signal'e hoş geldin"],
      ['az-AZ', 'Signal-ın dəstəyi'],
      ['ja', 'Signalへようこそ'],
      ['ko', 'Signal을 업데이트'],
      ['zh-CN', '在您的手机上打开Signal'],
      ['he', 'ברוכים הבאים ל-Signal'],
      ['gu-IN', 'Signalનો ઉપયોગ'],
      ['te-IN', 'SIGNAL ఎప్పటికీ'],
      ['es', 'Copiar el enlace de signal.group'],
      ['ar', 'تبرَّع لسيجنال'],
      ['fa-IR', 'حمایت از سیگنال'],
      ['ta-IN', 'சிக்னலைத் திறக்க முடியவில்லை'],
      ['ur', 'سگنل کو بند کریں'],
      ['ug', 'سىگنال يېڭىلىنالمىدى'],
      ['bn-BD', 'আপনার ফোনে সিগন্যাল খুলুন'],
      ['ja', 'シグナルをご利用いただき'],
      ['ko', '시그널 최신 버전으로 업데이트'],
      ['ka-GE', 'სიგნალის გამოყენებისთვის'],
      ['bg-BG', 'Добре дошли в Сигнал'],
      ['cs', 'Otevřete aplikaci Signál'],
      ['lv-LV', 'Sveicināti Signālā'],
      ['sr', 'спам у Signаl-у'],
    ];
    for (const [locale, text] of named) {
      assert.isDefined(findSignalName(locale, text), `${locale}: ${text}`);
    }

    const ordinary: ReadonlyArray<[string, string]> = [
      ['fr', 'Signaler comme spam'],
      ['fr', 'Signalé comme spam'],
      ['fr', 'signalera'],
      ['sv', 'Stäng av ringsignal'],
      ['lv-LV', 'Izslēgt zvana signālu'],
      ['ru', 'Подавать звуковой сигнал'],
      ['it', 'Segnala come spam'],
      ['fi', 'SWARM Messengerin'],
      ['de', 'SWARM Messenger'],
    ];
    for (const [locale, text] of ordinary) {
      assert.isUndefined(findSignalName(locale, text), `${locale}: ${text}`);
    }
  });

  it('_locales/*/messages.json: only the attribution names Signal', () => {
    const offences: Array<string> = [];
    for (const locale of locales) {
      const messages: Record<string, { messageformat?: unknown }> = JSON.parse(
        readFileSync(join(ROOT, '_locales', locale, 'messages.json'), 'utf8')
      );
      for (const [key, value] of Object.entries(messages)) {
        const text = value?.messageformat;
        if (typeof text !== 'string' || ALLOWED_KEYS.has(key)) {
          continue;
        }
        const found = findSignalName(locale, text);
        if (found !== undefined) {
          offences.push(`${locale} ${key}: "${found}" in ${text}`);
        }
      }
    }
    assert.strictEqual(offences.length, 0, report(offences));
  });

  it('build/SignalStrings.nsh: no installer string names Signal', () => {
    // Only the quoted text is shown to the user. The file name, the LangString
    // identifiers and the copyright header are internal and stay as they are.
    const lines = readFileSync(
      join(ROOT, 'build', 'SignalStrings.nsh'),
      'utf8'
    ).split(/\r?\n/);
    const offences: Array<string> = [];
    let strings = 0;
    let locale = 'en';
    for (const line of lines) {
      const lang = /^# ([a-z]{2,3}_[A-Z]{2})$/.exec(line)?.[1];
      if (lang !== undefined) {
        locale = nsisLocale(lang, locales);
        continue;
      }
      const [, id, lcid, text] =
        /^LangString (\w+) (\d+) "(.*)"$/.exec(line) ?? [];
      if (text === undefined) {
        continue;
      }
      strings += 1;
      const found = findSignalName(locale, text);
      if (found !== undefined) {
        offences.push(`${locale} ${id} ${lcid}: "${found}" in ${text}`);
      }
    }
    assert.isAbove(strings, 0, 'no LangString found; did the format change?');
    assert.strictEqual(offences.length, 0, report(offences));
  });
});
