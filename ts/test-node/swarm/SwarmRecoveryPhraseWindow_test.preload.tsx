// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the recovery phrase window, rendered to
// markup with the real English strings. What must hold: the warning comes
// first; the typed confirmation names the word and keeps "Show the words"
// disabled; the 24 words are numbered 1-24, three to a row, lower case, in the
// monospace face; "Save to file" says the file is plain text before anything
// is written; and "Copy" says when the clipboard is cleared.

import { assert } from 'chai';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

import i18n from '../util/i18n.node.ts';
import { AxoProvider } from '../../axo/AxoProvider.dom.tsx';
import type { AxoIntl } from '../../axo/_internal/AxoIntl.dom.tsx';
import {
  RecoveryPhraseWords,
  ShownPhrase,
  SwarmRecoveryPhraseWindow,
  TypedConfirmation,
} from '../../components/SwarmRecoveryPhraseWindow.dom.tsx';
import { phraseToSignInWith } from '../../components/standaloneRegistration/stages/WalletSignIn.dom.tsx';
import {
  checkRecoveryPhrase,
  entropyToPhrase,
  generateRecoveryPhrase,
} from '../../util/swarm/bip39.node.ts';
import { recoveryPhraseFileText } from '../../util/swarm/recoveryPhraseText.std.ts';
import { accountKeyForPhrase } from '../../util/swarm/walletIpc.node.ts';

// A published test vector, not anyone's phrase.
const WORDS = entropyToPhrase(
  new Uint8Array(Array.from({ length: 32 }, (_, i) => i))
).split(' ');

const AXO_MESSAGES: AxoIntl.Messages = {
  'AxoAlertDialog.Cancel': 'Cancel',
  'AxoButton.Pending': 'Pending',
  'AxoDialog.Back': 'Back',
  'AxoDialog.Close': 'Close',
  'AxoTextField.Clear': 'Clear',
  'AxoPasswordField.Reveal': 'Show Password',
  'AxoBadge.MaxOverflow': (max: number) => `${max}+`,
  'AxoContactName.InSystemContactsLabel': 'This person is in your contacts.',
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(
    <AxoProvider
      resolvedAppLocale={{
        tag: 'en' as AxoIntl.AppLocaleTag,
        direction: 'ltr',
      }}
      systemPreferredLanguages={new Set()}
      messages={AXO_MESSAGES}
    >
      {node}
    </AxoProvider>
  );
}

const never = () => new Promise<never>(() => undefined);

describe('SWARM recovery phrase window (B6)', () => {
  it('opens on the warning, with no words yet', () => {
    const html = render(
      <SwarmRecoveryPhraseWindow
        i18n={i18n}
        getStatus={never}
        onReveal={never}
        onCopy={never}
        onSave={never}
        onClose={() => undefined}
      />
    );
    assert.include(html, 'Your recovery phrase');
    assert.include(
      html,
      'Anyone who has these 24 words owns this account and the money in its wallet.'
    );
    assert.notInclude(html, 'data-testid="recovery-words"');
    for (const word of WORDS) {
      assert.notInclude(html, `>${word}<`);
    }
  });

  it('asks for the word "reveal", and keeps the button disabled until then', () => {
    const html = render(
      <TypedConfirmation
        i18n={i18n}
        waitUntil={Number.MAX_SAFE_INTEGER}
        wrong={false}
        onReveal={async () => undefined}
        onClose={() => undefined}
      />
    );
    assert.include(html, 'To show the words, type reveal below.');
    assert.include(html, 'Show the words');
    assert.match(
      html,
      /aria-disabled="true"[^>]*>(?:(?!<\/button>).)*Show the words/s
    );
    assert.include(html, 'Cancel');
  });

  it('numbers the 24 words 1 to 24, three to a row, lower case, monospace', () => {
    const html = render(
      <RecoveryPhraseWords
        i18n={i18n}
        words={WORDS.map(word => word.toUpperCase())}
      />
    );
    assert.include(html, 'grid-cols-3');
    assert.include(html, 'font-swarm-mono');
    assert.strictEqual(html.match(/<li /g)?.length, 24);
    for (const [index, word] of WORDS.entries()) {
      assert.include(html, `>${index + 1}</span>`);
      assert.include(html, `>${word}</span>`);
    }
    assert.notInclude(html, WORDS[0]?.toUpperCase() ?? 'x');
  });

  it('offers Copy, Save to file and Close beside the words', () => {
    const html = render(
      <ShownPhrase
        i18n={i18n}
        words={WORDS}
        closesAt={Number.MAX_SAFE_INTEGER}
        onCopy={never}
        onSave={never}
        onClose={() => undefined}
      />
    );
    assert.include(html, 'data-testid="recovery-words"');
    assert.include(html, '>Copy<');
    assert.include(html, 'Save to file');
    assert.include(html, '>Close<');
    assert.notInclude(html, 'data-testid="recovery-save-confirm"');
  });

  it('says the file is plain text before it is written', () => {
    const html = render(
      <ShownPhrase
        i18n={i18n}
        words={WORDS}
        closesAt={Number.MAX_SAFE_INTEGER}
        onCopy={never}
        onSave={never}
        onClose={() => undefined}
        initialSave={{ type: 'confirming' }}
      />
    );
    assert.include(html, 'data-testid="recovery-save-confirm"');
    assert.include(html, 'The file will be plain text, not encrypted');
    assert.include(html, 'Save plain text file');
    assert.include(html, 'Cancel');
  });

  it('has a sentence for the clipboard being cleared', () => {
    assert.strictEqual(
      i18n('icu:SwarmWallet__recovery--copied', { seconds: 60 }),
      'Copied. The clipboard will be cleared in 60 seconds if it still holds the words.'
    );
    assert.strictEqual(
      i18n('icu:SwarmWallet__recovery--closes-in', { seconds: 1 }),
      'This window closes by itself in 1 second.'
    );
  });
});

describe('SWARM recovery phrase: the saved file at "Restore a wallet" (B6)', () => {
  // A throwaway phrase, made for this test.
  const phrase = generateRecoveryPhrase();
  // Exactly what "Save to file" writes: the real English warning line.
  const file = recoveryPhraseFileText(
    phrase,
    i18n('icu:SwarmWallet__recovery--file-warning')
  );

  it('starts with the warning, then the words', () => {
    assert.match(file, /^# SWARM Messenger recovery phrase\. .*NOT encrypted/);
    assert.isTrue(file.endsWith(`\n\n${phrase}\n`));
  });

  for (const [name, pasted] of [
    ['the whole file', file],
    ['the whole file with Windows line endings', file.replace(/\n/g, '\r\n')],
    ['the words line alone', file.split('\n')[2] ?? ''],
  ] as const) {
    it(`the sign-in stage accepts ${name} as the same account`, () => {
      const signedInWith = phraseToSignInWith(pasted);
      assert.isDefined(signedInWith);
      const check = checkRecoveryPhrase(signedInWith ?? '');
      assert.isTrue(check.valid);
      assert.strictEqual(check.valid ? check.phrase : '', phrase);
      assert.deepEqual(
        accountKeyForPhrase(signedInWith ?? ''),
        accountKeyForPhrase(phrase)
      );
    });
  }

  it('the sign-in stage waits for 24 words: the warning line is not one', () => {
    const warningOnly = file.split('\n')[0] ?? '';
    assert.isUndefined(phraseToSignInWith(warningOnly));
    assert.isUndefined(
      phraseToSignInWith(
        `${warningOnly}\n${phrase.split(' ').slice(1).join(' ')}`
      )
    );
  });
});
