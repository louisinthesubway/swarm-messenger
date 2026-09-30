// Copyright 2026 SWARM
// SPDX-License-Identifier: AGPL-3.0-only
//
// SWARM addition (B6, 2026-09-29): the recovery phrase window.
//
// The only screen that ever draws the 24 words after sign-in. It opens from the
// Wallet tab, in a small window of its own that the main process keeps on top,
// content-protected and short-lived (app/SwarmRecoveryPhraseExport.main.ts).
// When the operating system could not confirm the person, they type the word
// "reveal" and wait three seconds; the main process checks both again.
//
// The words live in this component's state while it is shown and nowhere else
// on this side: nothing here logs, stores or sends them, except back to the
// main process for "Copy" and "Save to file", which act only on the exact
// words this window was given.

import { useCallback, useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { tw } from '../axo/tw.dom.tsx';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { RECOVERY_PHRASE_REVEAL_WORD } from '../types/SwarmRecoveryPhrase.std.ts';
import type {
  RecoveryPhraseCopyAnswerType,
  RecoveryPhraseRevealRefusalType,
  RecoveryPhraseRevealResultType,
  RecoveryPhraseSaveAnswerType,
  RecoveryPhraseStatusType,
} from '../types/SwarmRecoveryPhrase.std.ts';
import type { LocalizerType } from '../types/Util.std.ts';

export type SwarmRecoveryPhraseWindowProps = Readonly<{
  i18n: LocalizerType;
  getStatus: () => Promise<RecoveryPhraseStatusType>;
  /**
   * Asks for the words. `onBusy` is called when the wallet is busy and they
   * will take a while (SWARM change, 0.1.3).
   */
  onReveal: (
    confirmation: string,
    onBusy: () => void
  ) => Promise<RecoveryPhraseRevealResultType>;
  onCopy: (
    words: ReadonlyArray<string>
  ) => Promise<RecoveryPhraseCopyAnswerType>;
  onSave: (
    words: ReadonlyArray<string>
  ) => Promise<RecoveryPhraseSaveAnswerType>;
  onClose: () => void;
}>;

type StageType =
  | Readonly<{ type: 'loading' }>
  | Readonly<{ type: 'typed'; waitUntil: number; wrong: boolean }>
  | Readonly<{ type: 'revealing' }>
  | Readonly<{ type: 'busy' }>
  | Readonly<{
      type: 'shown';
      words: ReadonlyArray<string>;
      closesAt: number;
    }>
  | Readonly<{
      type: 'refused';
      refusal:
        | Exclude<RecoveryPhraseRevealRefusalType, 'not-confirmed'>
        | 'error';
    }>;

/**
 * Seconds left until `deadline`, ticking. Undefined until the first tick, so
 * nothing impure runs while rendering.
 */
function useSecondsLeft(deadline: number | undefined): number | undefined {
  const [seconds, setSeconds] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (deadline == null) {
      return undefined;
    }
    const tick = () =>
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [deadline]);
  return deadline == null ? undefined : seconds;
}

export function SwarmRecoveryPhraseWindow({
  i18n,
  getStatus,
  onReveal,
  onCopy,
  onSave,
  onClose,
}: SwarmRecoveryPhraseWindowProps): JSX.Element {
  const [stage, setStage] = useState<StageType>({ type: 'loading' });

  const reveal = useCallback(
    async (confirmation: string, waitUntil: number) => {
      setStage({ type: 'revealing' });
      let result: RecoveryPhraseRevealResultType;
      try {
        result = await onReveal(confirmation, () =>
          setStage(current =>
            current.type === 'revealing' ? { type: 'busy' } : current
          )
        );
      } catch {
        setStage({ type: 'refused', refusal: 'error' });
        return;
      }
      if (result.ok) {
        setStage({
          type: 'shown',
          words: result.words,
          closesAt: Date.now() + result.closesInMs,
        });
      } else if (result.refusal === 'not-confirmed') {
        setStage({ type: 'typed', waitUntil, wrong: true });
      } else {
        setStage({ type: 'refused', refusal: result.refusal });
      }
    },
    [onReveal]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let status: RecoveryPhraseStatusType;
      try {
        status = await getStatus();
      } catch {
        if (!cancelled) {
          setStage({ type: 'refused', refusal: 'used' });
        }
        return;
      }
      if (cancelled) {
        return;
      }
      if (status.confirmation === 'os') {
        // Touch ID or Windows Hello confirmed the person before this window
        // opened; there is nothing more to ask.
        await reveal('', 0);
      } else {
        setStage({
          type: 'typed',
          waitUntil: Date.now() + status.waitMs,
          wrong: false,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getStatus, reveal]);

  return (
    <div
      data-testid="SwarmRecoveryPhraseWindow"
      className={tw('flex size-full flex-col overflow-y-auto')}
    >
      <div className={tw('flex w-full flex-col gap-4 p-6')}>
        <h1 className={tw('type-title-large text-primary')}>
          {i18n('icu:SwarmWallet__recovery--heading')}
        </h1>
        <RecoveryPhraseWarning i18n={i18n} />
        <Stage
          i18n={i18n}
          stage={stage}
          onReveal={reveal}
          onCopy={onCopy}
          onSave={onSave}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function Stage({
  i18n,
  stage,
  onReveal,
  onCopy,
  onSave,
  onClose,
}: {
  i18n: LocalizerType;
  stage: StageType;
  onReveal: (confirmation: string, waitUntil: number) => Promise<void>;
  onCopy: SwarmRecoveryPhraseWindowProps['onCopy'];
  onSave: SwarmRecoveryPhraseWindowProps['onSave'];
  onClose: () => void;
}): JSX.Element {
  switch (stage.type) {
    case 'loading':
    case 'revealing':
      return (
        <p className={tw('type-body-medium text-secondary')}>
          {i18n('icu:SwarmWallet__recovery--loading')}
        </p>
      );
    case 'busy':
      return <WaitingForWallet i18n={i18n} onClose={onClose} />;
    case 'typed':
      return (
        <TypedConfirmation
          i18n={i18n}
          waitUntil={stage.waitUntil}
          wrong={stage.wrong}
          onReveal={onReveal}
          onClose={onClose}
        />
      );
    case 'shown':
      return (
        <ShownPhrase
          i18n={i18n}
          words={stage.words}
          closesAt={stage.closesAt}
          onCopy={onCopy}
          onSave={onSave}
          onClose={onClose}
        />
      );
    case 'refused':
      return (
        <RecoveryPhraseRefused
          i18n={i18n}
          refusal={stage.refusal}
          onClose={onClose}
        />
      );
    default:
      return <span />;
  }
}

/**
 * SWARM addition (0.1.3): the words were asked for and the wallet is busy -
 * syncing, or answering the Wallet tab. They appear by themselves when it is
 * free; Cancel closes the window, and nothing is shown.
 */
export function WaitingForWallet({
  i18n,
  onClose,
}: {
  i18n: LocalizerType;
  onClose: () => void;
}): JSX.Element {
  return (
    <section data-testid="recovery-busy" className={tw('flex flex-col gap-3')}>
      <p className={tw('type-body-medium text-secondary')}>
        {i18n('icu:SwarmWallet__recovery--busy')}
      </p>
      <Buttons>
        <AxoButton.Root variant="strong-secondary" size="md" onClick={onClose}>
          {i18n('icu:SwarmWallet__recovery--cancel')}
        </AxoButton.Root>
      </Buttons>
    </section>
  );
}

export function RecoveryPhraseRefused({
  i18n,
  refusal,
  onClose,
}: {
  i18n: LocalizerType;
  refusal: Exclude<RecoveryPhraseRevealRefusalType, 'not-confirmed'> | 'error';
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <p
        data-testid="recovery-refused"
        className={tw('type-body-medium text-destructive')}
      >
        {refusalText(i18n, refusal)}
      </p>
      <Buttons>
        <AxoButton.Root variant="strong-secondary" size="md" onClick={onClose}>
          {i18n('icu:SwarmWallet__recovery--close')}
        </AxoButton.Root>
      </Buttons>
    </>
  );
}

function refusalText(
  i18n: LocalizerType,
  refusal: Exclude<RecoveryPhraseRevealRefusalType, 'not-confirmed'> | 'error'
): string {
  switch (refusal) {
    case 'unreadable':
      return i18n('icu:SwarmWallet__recovery--unreadable');
    case 'busy':
      return i18n('icu:SwarmWallet__recovery--busy-too-long');
    case 'used':
      return i18n('icu:SwarmWallet__recovery--used');
    default:
      return i18n('icu:SwarmWallet__recovery--error');
  }
}

/** Who owns the words, said before anything else on the screen. */
function RecoveryPhraseWarning({ i18n }: { i18n: LocalizerType }): JSX.Element {
  return (
    <p
      data-testid="recovery-warning"
      className={tw('type-body-medium text-primary')}
    >
      {i18n('icu:SwarmWallet__recovery--warning')}
    </p>
  );
}

function Buttons({ children }: { children: ReactNode }): JSX.Element {
  return <div className={tw('flex flex-wrap gap-2')}>{children}</div>;
}

// Before the words: the typed word and the wait -------------------------------------

export function TypedConfirmation({
  i18n,
  waitUntil,
  wrong,
  onReveal,
  onClose,
}: {
  i18n: LocalizerType;
  waitUntil: number;
  wrong: boolean;
  onReveal: (confirmation: string, waitUntil: number) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const [typed, setTyped] = useState('');
  const secondsLeft = useSecondsLeft(waitUntil);
  const waiting = secondsLeft == null || secondsLeft > 0;
  const matches = typed.trim().toLowerCase() === RECOVERY_PHRASE_REVEAL_WORD;

  return (
    <section data-testid="recovery-typed" className={tw('flex flex-col gap-3')}>
      <label
        htmlFor="swarm-recovery-confirmation"
        className={tw('type-body-medium text-primary')}
      >
        {i18n('icu:SwarmWallet__recovery--type-word', {
          word: RECOVERY_PHRASE_REVEAL_WORD,
        })}
      </label>
      <input
        id="swarm-recovery-confirmation"
        type="text"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className={tw(
          'h-10 w-full rounded-lg border border-primary bg-surface-primary px-3',
          'type-body-medium text-primary'
        )}
        value={typed}
        onChange={event => setTyped(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && matches && !waiting) {
            void onReveal(typed, waitUntil);
          }
        }}
      />
      {waiting && secondsLeft != null ? (
        <p
          data-testid="recovery-wait"
          className={tw('type-body-small text-secondary')}
        >
          {i18n('icu:SwarmWallet__recovery--wait', { seconds: secondsLeft })}
        </p>
      ) : null}
      {wrong ? (
        <p className={tw('type-body-small text-destructive')}>
          {i18n('icu:SwarmWallet__recovery--wrong-word')}
        </p>
      ) : null}
      <Buttons>
        <AxoButton.Root
          variant="strong-primary"
          size="md"
          disabled={!matches || waiting}
          onClick={() => {
            if (matches && !waiting) {
              void onReveal(typed, waitUntil);
            }
          }}
        >
          {i18n('icu:SwarmWallet__recovery--show')}
        </AxoButton.Root>
        <AxoButton.Root variant="strong-secondary" size="md" onClick={onClose}>
          {i18n('icu:SwarmWallet__recovery--cancel')}
        </AxoButton.Root>
      </Buttons>
    </section>
  );
}

// The words -------------------------------------------------------------------------

/**
 * The 24 words, numbered 1 to 24, three to a row, in lower case and a
 * monospace face: the letters to copy down exactly.
 */
export function RecoveryPhraseWords({
  i18n,
  words,
}: {
  i18n: LocalizerType;
  words: ReadonlyArray<string>;
}): JSX.Element {
  return (
    <ol
      data-testid="recovery-words"
      aria-label={i18n('icu:SwarmWallet__recovery--word-list')}
      className={tw(
        'grid grid-cols-3 gap-x-4 gap-y-1 rounded-lg bg-surface-secondary p-4',
        'font-swarm-mono type-body-medium text-primary select-none'
      )}
    >
      {words.map((word, index) => (
        // The same word can appear twice in a phrase; its place cannot.
        // oxlint-disable-next-line react/no-array-index-key
        <li key={index} className={tw('flex gap-2')}>
          <span className={tw('w-6 shrink-0 text-end text-secondary')}>
            {index + 1}
          </span>
          <span className={tw('lowercase')}>{word.toLowerCase()}</span>
        </li>
      ))}
    </ol>
  );
}

type CopyStateType =
  | Readonly<{ type: 'idle' }>
  | Readonly<{ type: 'copied'; clearsInSeconds: number }>
  | Readonly<{ type: 'failed' }>;

type SaveStateType =
  | Readonly<{ type: 'idle' }>
  | Readonly<{ type: 'confirming' }>
  | Readonly<{ type: 'saving' }>
  | Readonly<{ type: 'saved' }>
  | Readonly<{ type: 'failed' }>;

export function ShownPhrase({
  i18n,
  words,
  closesAt,
  onCopy,
  onSave,
  onClose,
  initialSave = { type: 'idle' },
}: {
  i18n: LocalizerType;
  words: ReadonlyArray<string>;
  closesAt: number;
  onCopy: SwarmRecoveryPhraseWindowProps['onCopy'];
  onSave: SwarmRecoveryPhraseWindowProps['onSave'];
  onClose: () => void;
  /** For tests of the confirmation step. */
  initialSave?: SaveStateType;
}): JSX.Element {
  const secondsLeft = useSecondsLeft(closesAt);
  const [copy, setCopy] = useState<CopyStateType>({ type: 'idle' });
  const [save, setSave] = useState<SaveStateType>(initialSave);

  const doCopy = async () => {
    try {
      const answer = await onCopy(words);
      setCopy(
        answer.ok
          ? {
              type: 'copied',
              clearsInSeconds: Math.round(answer.clearsInMs / 1000),
            }
          : { type: 'failed' }
      );
    } catch {
      setCopy({ type: 'failed' });
    }
  };

  const doSave = async () => {
    setSave({ type: 'saving' });
    let answer: RecoveryPhraseSaveAnswerType;
    try {
      answer = await onSave(words);
    } catch {
      answer = 'failed';
    }
    if (answer === 'saved') {
      setSave({ type: 'saved' });
    } else if (answer === 'cancelled') {
      setSave({ type: 'idle' });
    } else {
      setSave({ type: 'failed' });
    }
  };

  return (
    <section data-testid="recovery-shown" className={tw('flex flex-col gap-3')}>
      <RecoveryPhraseWords i18n={i18n} words={words} />
      {secondsLeft != null ? (
        <p
          data-testid="recovery-closes-in"
          className={tw('type-body-small text-secondary')}
        >
          {i18n('icu:SwarmWallet__recovery--closes-in', {
            seconds: secondsLeft,
          })}
        </p>
      ) : null}

      {save.type === 'confirming' ? (
        <div
          data-testid="recovery-save-confirm"
          className={tw(
            'flex flex-col gap-3 rounded-lg border border-primary p-4'
          )}
        >
          <p className={tw('type-body-medium text-primary')}>
            {i18n('icu:SwarmWallet__recovery--save-confirm')}
          </p>
          <Buttons>
            <AxoButton.Root
              variant="strong-destructive"
              size="md"
              onClick={() => {
                void doSave();
              }}
            >
              {i18n('icu:SwarmWallet__recovery--save-confirm-button')}
            </AxoButton.Root>
            <AxoButton.Root
              variant="strong-secondary"
              size="md"
              onClick={() => setSave({ type: 'idle' })}
            >
              {i18n('icu:SwarmWallet__recovery--cancel')}
            </AxoButton.Root>
          </Buttons>
        </div>
      ) : (
        <Buttons>
          <AxoButton.Root
            variant="strong-secondary"
            size="md"
            onClick={() => {
              void doCopy();
            }}
          >
            {i18n('icu:SwarmWallet__recovery--copy')}
          </AxoButton.Root>
          <AxoButton.Root
            variant="strong-secondary"
            size="md"
            pending={save.type === 'saving'}
            onClick={() => setSave({ type: 'confirming' })}
          >
            {i18n('icu:SwarmWallet__recovery--save')}
          </AxoButton.Root>
          <AxoButton.Root variant="strong-primary" size="md" onClick={onClose}>
            {i18n('icu:SwarmWallet__recovery--close')}
          </AxoButton.Root>
        </Buttons>
      )}

      {copy.type === 'copied' ? (
        <p
          data-testid="recovery-copied"
          className={tw('type-body-small text-secondary')}
        >
          {i18n('icu:SwarmWallet__recovery--copied', {
            seconds: copy.clearsInSeconds,
          })}
        </p>
      ) : null}
      {copy.type === 'failed' ? (
        <p className={tw('type-body-small text-destructive')}>
          {i18n('icu:SwarmWallet__recovery--copy-failed')}
        </p>
      ) : null}
      {save.type === 'saved' ? (
        <p
          data-testid="recovery-saved"
          className={tw('type-body-small text-secondary')}
        >
          {i18n('icu:SwarmWallet__recovery--saved')}
        </p>
      ) : null}
      {save.type === 'failed' ? (
        <p className={tw('type-body-small text-destructive')}>
          {i18n('icu:SwarmWallet__recovery--save-failed')}
        </p>
      ) : null}
    </section>
  );
}
