// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (wallet sign-in). The screen a SWARM account starts at, in place
// of the phone number, captcha and SMS-code screens: create a wallet, or restore
// one from its recovery phrase. The same 24 words are the money and the account.

import { useCallback, useState } from 'react';

import type { JSX } from 'react';

import { tw } from '../../../axo/tw.dom.tsx';
import { AxoButton } from '../../../axo/AxoButton.dom.tsx';
import {
  Buttons,
  Container,
  Description,
  Spacer,
  Title,
  TopMatter,
} from '../util/StepComponents.dom.tsx';
import { RECOVERY_PHRASE_WORDS } from '../../../util/swarm/bip39Wordlist.std.ts';
import {
  countRecoveryPhraseWords,
  recoveryPhraseFromText,
} from '../../../util/swarm/recoveryPhraseText.std.ts';

import type { LocalizerType } from '../../../types/I18N.std.ts';
import type { ActionCreator } from '../../../state/types.std.ts';
import type {
  WalletSignInError,
  WalletSignInStage,
} from '../../../types/StandaloneRegistration.std.ts';
import type {
  backToWalletChoice as doBackToWalletChoice,
  createWalletForSignIn as doCreateWalletForSignIn,
  enterRecoveryPhrase as doEnterRecoveryPhrase,
  signInWithWallet as doSignInWithWallet,
} from '../../../state/ducks/standaloneInstaller.preload.ts';

export function WalletSignInScreen({
  i18n,
  backToWalletChoice,
  cancelRegistration,
  createWalletForSignIn,
  enterRecoveryPhrase,
  signInWithWallet,
  workflow,
}: {
  i18n: LocalizerType;
  backToWalletChoice: ActionCreator<typeof doBackToWalletChoice>;
  cancelRegistration: () => unknown;
  createWalletForSignIn: ActionCreator<typeof doCreateWalletForSignIn>;
  enterRecoveryPhrase: ActionCreator<typeof doEnterRecoveryPhrase>;
  signInWithWallet: ActionCreator<typeof doSignInWithWallet>;
  workflow: WalletSignInStage;
}): JSX.Element {
  const { status } = workflow;

  const [typedPhrase, setTypedPhrase] = useState('');
  const [writtenDown, setWrittenDown] = useState(false);

  const onRestore = useCallback(() => {
    const phrase = phraseToSignInWith(typedPhrase);
    if (phrase == null) {
      return;
    }
    signInWithWallet({ phrase, workflow });
  }, [signInWithWallet, typedPhrase, workflow]);

  const inProgress = status.type === 'in-progress';

  // The words, while they are on screen for the person to copy down. They are in
  // the workflow only for as long as this screen shows them.
  const newPhrase =
    status.type === 'showing-new-phrase' ? status.phrase : undefined;

  const failure = status.type === 'failed' ? status : undefined;

  // Which of the three screens to draw. A failure returns to the one it came
  // from, with the reason above the buttons.
  const screen = (() => {
    if (newPhrase != null) {
      return 'new-phrase' as const;
    }
    if (status.type === 'entering-phrase') {
      return 'restore' as const;
    }
    if (failure != null) {
      return failure.returnTo === 'entering-phrase'
        ? ('restore' as const)
        : ('choose' as const);
    }
    return 'choose' as const;
  })();

  return (
    // The 24 words make this the tallest screen in the flow; the shared
    // container's fixed height would put the button below the fold, where a
    // person who has just been told to write something down will not look.
    <Container className={tw('h-auto')}>
      <TopMatter
        i18n={i18n}
        onBackClick={
          screen === 'choose'
            ? () => cancelRegistration()
            : () => backToWalletChoice({ workflow })
        }
      />
      <Spacer className={tw('h-13')} />

      {screen === 'choose' ? (
        <>
          <Title
            text={i18n('icu:StandaloneRegistration--WalletSignIn--header')}
          />
          <Description>
            <div>
              {i18n(
                'icu:StandaloneRegistration--WalletSignIn--description--line-1'
              )}
            </div>
            <div>
              {i18n(
                'icu:StandaloneRegistration--WalletSignIn--description--line-2'
              )}
            </div>
          </Description>
          <Spacer className={tw('grow')} />
          {failure != null ? (
            <FailureText error={failure.error} i18n={i18n} />
          ) : undefined}
          {/* Stacked, not the usual row: two buttons side by side truncate both
              labels in this narrow pane, and "I have a recovery phrase" is not a
              sentence anyone should have to guess at. */}
          <div className={tw('flex w-full flex-col gap-2')}>
            <AxoButton.Root
              variant="strong-primary"
              size="md"
              pending={inProgress}
              onClick={() => {
                if (inProgress) {
                  return;
                }
                createWalletForSignIn({ workflow });
              }}
            >
              {i18n('icu:StandaloneRegistration--WalletSignIn--create')}
            </AxoButton.Root>
            <AxoButton.Root
              variant="subtle-secondary"
              size="md"
              disabled={inProgress}
              onClick={() => enterRecoveryPhrase({ workflow })}
            >
              {i18n('icu:StandaloneRegistration--WalletSignIn--restore')}
            </AxoButton.Root>
          </div>
        </>
      ) : undefined}

      {screen === 'new-phrase' && newPhrase != null ? (
        <>
          <Title
            text={i18n(
              'icu:StandaloneRegistration--WalletSignIn--Backup--header'
            )}
          />
          <Description>
            <div>
              {i18n(
                'icu:StandaloneRegistration--WalletSignIn--Backup--description'
              )}
            </div>
          </Description>
          <Spacer className={tw('h-6')} />
          <ol
            className={tw(
              'grid w-81 grid-cols-4 gap-x-3 gap-y-0.5 rounded-lg bg-surface-secondary p-3',
              'type-body-medium text-primary'
            )}
          >
            {newPhrase.split(' ').map((word, index) => (
              // oxlint-disable-next-line react/no-array-index-key
              <li key={`${index}-${word}`} className={tw('flex gap-2')}>
                <span className={tw('w-4 shrink-0 text-end text-secondary')}>
                  {index + 1}
                </span>
                {/* Lower case on purpose: these are the letters to copy down,
                    and a heading style that upper-cases them would have people
                    writing down something that is not what we generated. */}
                <span className={tw('lowercase select-text')}>{word}</span>
              </li>
            ))}
          </ol>
          <Spacer className={tw('h-4')} />
          <label className={tw('flex w-81 items-start gap-2 type-body-medium')}>
            <input
              type="checkbox"
              checked={writtenDown}
              disabled={inProgress}
              onChange={event => setWrittenDown(event.target.checked)}
            />
            <span>
              {i18n(
                'icu:StandaloneRegistration--WalletSignIn--Backup--confirm'
              )}
            </span>
          </label>
          <Spacer className={tw('h-4')} />
          {failure != null ? (
            <FailureText error={failure.error} i18n={i18n} />
          ) : undefined}
          <Buttons>
            <AxoButton.Root
              variant="strong-primary"
              size="md"
              disabled={!writtenDown}
              pending={inProgress}
              // The check is repeated here, and not left to `disabled` alone,
              // because this is the click that creates the account: if it ever
              // arrived while the box was unticked - a stray click inherited by
              // the re-used button element, a disabled state that is only
              // styling - somebody would own an account whose recovery phrase
              // they had not written down, and nothing could give it back.
              onClick={() => {
                if (!writtenDown || inProgress) {
                  return;
                }
                signInWithWallet({ phrase: newPhrase, workflow });
              }}
            >
              {i18n('icu:StandaloneRegistration--WalletSignIn--Backup--button')}
            </AxoButton.Root>
          </Buttons>
        </>
      ) : undefined}

      {screen === 'restore' ? (
        <>
          <Title
            text={i18n(
              'icu:StandaloneRegistration--WalletSignIn--Restore--header'
            )}
          />
          <Description>
            <div>
              {i18n(
                'icu:StandaloneRegistration--WalletSignIn--Restore--description'
              )}
            </div>
          </Description>
          <Spacer className={tw('h-6')} />
          <textarea
            autoFocus
            aria-label={i18n(
              'icu:StandaloneRegistration--WalletSignIn--Restore--placeholder'
            )}
            className={tw(
              'h-28 w-81 resize-none rounded-lg border border-primary',
              'bg-surface-primary p-3 type-body-medium text-primary'
            )}
            disabled={inProgress}
            placeholder={i18n(
              'icu:StandaloneRegistration--WalletSignIn--Restore--placeholder'
            )}
            spellCheck={false}
            value={typedPhrase}
            onChange={event => setTypedPhrase(event.target.value)}
          />
          <Spacer className={tw('grow')} />
          {failure != null ? (
            <FailureText error={failure.error} i18n={i18n} />
          ) : undefined}
          <Buttons>
            <AxoButton.Root
              variant="strong-primary"
              size="md"
              disabled={countWords(typedPhrase) !== RECOVERY_PHRASE_WORDS}
              pending={inProgress}
              onClick={onRestore}
            >
              {i18n(
                'icu:StandaloneRegistration--WalletSignIn--Restore--button'
              )}
            </AxoButton.Root>
          </Buttons>
        </>
      ) : undefined}
    </Container>
  );
}

function FailureText({
  error,
  i18n,
}: {
  error: WalletSignInError;
  i18n: LocalizerType;
}): JSX.Element {
  const text = (() => {
    switch (error) {
      case 'invalid-phrase':
        return i18n('icu:StandaloneRegistration--WalletSignIn--error--phrase');
      case 'identifier-taken':
        return i18n(
          'icu:StandaloneRegistration--WalletSignIn--error--identifier-taken'
        );
      case 'challenge-expired':
        return i18n('icu:StandaloneRegistration--WalletSignIn--error--expired');
      case 'rejected':
        return i18n(
          'icu:StandaloneRegistration--WalletSignIn--error--rejected'
        );
      case 'network':
        return i18n('icu:StandaloneRegistration--WalletSignIn--error--network');
      case 'unexpected':
      default:
        return i18n(
          'icu:StandaloneRegistration--WalletSignIn--error--unexpected'
        );
    }
  })();

  return (
    <div className={tw('w-81 pb-4 type-body-medium text-destructive')}>
      {text}
    </div>
  );
}

function countWords(value: string): number {
  // SWARM change (B6, 2026-09-29): a saved file's warning line is not a word.
  return countRecoveryPhraseWords(value);
}

/**
 * SWARM addition (B6, 2026-09-29): what "I have a recovery phrase" signs in
 * with, from whatever was typed or pasted - including a whole file saved from
 * the Wallet tab's "Recovery phrase", warning line and all. Undefined until
 * there are exactly 24 words; checkRecoveryPhrase does the rest of the
 * normalization and the checksum.
 */
export function phraseToSignInWith(typed: string): string | undefined {
  if (countWords(typed) !== RECOVERY_PHRASE_WORDS) {
    return undefined;
  }
  return recoveryPhraseFromText(typed);
}
