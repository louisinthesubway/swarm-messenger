// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { useState, useCallback } from 'react';

import type { JSX } from 'react';

import { normalizeProfileName } from '../../../util/normalizeProfileName.std.ts';
import { AvatarColors } from '../../../types/Colors.std.ts';
import { PhoneNumberDiscoverability } from '../../../util/phoneNumberDiscoverability.std.ts';
import { AvatarPreview } from '../../AvatarPreview.dom.tsx';
import { AvatarEditor } from '../../AvatarEditor.dom.tsx';
import { tw } from '../../../axo/tw.dom.tsx';
import { AxoButton } from '../../../axo/AxoButton.dom.tsx';
import { AxoDialog } from '../../../axo/AxoDialog.dom.tsx';
import { AxoTextField } from '../../../axo/fields/AxoTextField.dom.tsx';

import type { LocalizerType } from '../../../types/I18N.std.ts';
import type { ActionCreator } from '../../../state/types.std.ts';
import type {
  AvatarDataType,
  DeleteAvatarFromDiskActionType,
  ReplaceAvatarActionType,
  SaveAvatarToDiskActionType,
} from '../../../types/Avatar.std.ts';
import type { ProfileEntryStage } from '../../../types/StandaloneRegistration.std.ts';
import type { finishProfileEntryStage as doFinishProfileEntryStage } from '../../../state/ducks/standaloneInstaller.preload.ts';
import {
  Buttons,
  Container,
  Description,
  InputContainer,
  Spacer,
  Title,
} from '../util/StepComponents.dom.tsx';

export function ProfileEntryScreen({
  conversationId,
  finishProfileEntryStage,
  i18n,
  workflow,
  deleteAvatarFromDisk,
  replaceAvatar,
  saveAvatarToDisk,
  userAvatarData,
}: {
  conversationId?: string;
  finishProfileEntryStage: ActionCreator<typeof doFinishProfileEntryStage>;
  i18n: LocalizerType;
  workflow: ProfileEntryStage;
  deleteAvatarFromDisk: DeleteAvatarFromDiskActionType;
  replaceAvatar: ReplaceAvatarActionType;
  saveAvatarToDisk: SaveAvatarToDiskActionType;
  userAvatarData: ReadonlyArray<AvatarDataType>;
}): JSX.Element {
  const { profileData } = workflow;
  const [firstName, setFirstName] = useState(profileData?.firstName ?? '');
  const [lastName, setLastName] = useState(profileData?.lastName ?? '');
  const [avatarData, setAvatarData] = useState<
    Uint8Array<ArrayBuffer> | undefined
  >(profileData?.avatarData);

  const [isEditingAvatar, setIsEditingAvatar] = useState(false);

  const onChangeFirstName = useCallback(
    (value: string) => setFirstName(value),
    []
  );

  const onChangeLastName = useCallback(
    (value: string) => setLastName(value),
    []
  );

  const fullName = `${firstName} ${lastName}`;
  const { status } = workflow;
  const pending = status.type === 'in-progress';

  return (
    <Container className={tw('h-125')}>
      <Spacer className={tw('h-6')} />
      <Title text={i18n('icu:StandaloneRegistration--ProfileEntry--header')} />
      <Description className={tw('w-full')}>
        <div>
          {i18n('icu:StandaloneRegistration--ProfileEntry--description')}
        </div>
        <div>
          <a className={tw('text-primary')} href="https://swarm.green/support">
            {i18n('icu:StandaloneRegistration--ProfileEntry--learn-more')}
          </a>
        </div>
      </Description>
      <Spacer className={tw('h-7')} />
      <div className={tw('-mb-1')}>
        <AvatarPreview
          avatarColor={AvatarColors[0]}
          avatarUrl={undefined}
          avatarValue={avatarData}
          conversationTitle={fullName}
          i18n={i18n}
          onAvatarLoaded={avatar => {
            setAvatarData(avatar);
          }}
          onClick={
            pending
              ? undefined
              : () => {
                  setIsEditingAvatar(true);
                }
          }
          style={{
            height: 80,
            width: 80,
          }}
        />
      </div>
      <AxoButton.Root
        variant="strong-secondary"
        size="md"
        disabled={pending}
        onClick={() => setIsEditingAvatar(true)}
      >
        {i18n('icu:StandaloneRegistration--ProfileEntry--add-photo')}
      </AxoButton.Root>
      <Spacer className={tw('h-7')} />
      <InputContainer className={tw('w-100')}>
        <AxoTextField.Root disabled={pending}>
          <AxoTextField.Input
            placeholder={i18n(
              'icu:StandaloneRegistration--ProfileEntry--first-name'
            )}
            maxGraphemes={30}
            maxBytes={30}
            onValueChange={onChangeFirstName}
            value={firstName}
          />
        </AxoTextField.Root>
      </InputContainer>
      <Spacer />
      <InputContainer className={tw('w-100')}>
        <AxoTextField.Root disabled={pending}>
          <AxoTextField.Input
            placeholder={i18n(
              'icu:StandaloneRegistration--ProfileEntry--last-name'
            )}
            maxGraphemes={30}
            maxBytes={30}
            onValueChange={onChangeLastName}
            value={lastName}
          />
        </AxoTextField.Root>
      </InputContainer>
      <Spacer className={tw('h-4')} />
      {/*
        SWARM change (B4, 2026-09-29): no "Who can find me by phone number" row.
        A SWARM account signs in with its wallet and has no phone number; the
        stored discoverability is still sent as upstream sends it (the value
        this row chose was never used: Continue always sends Discoverable).
      */}
      <Spacer className={tw('grow')} />
      <Buttons>
        <AxoButton.Root
          variant="strong-primary"
          size="md"
          pending={pending}
          disabled={!normalizeProfileName(firstName) || pending}
          onClick={() => {
            const normalizedFirstName = normalizeProfileName(firstName);
            if (!normalizedFirstName) {
              throw new Error(
                'ProfileEntryScreen: Somehow clicked Continue with blank firstname'
              );
            }

            finishProfileEntryStage({
              profileData: {
                firstName: normalizedFirstName,
                lastName: normalizeProfileName(lastName),
                avatarData,
                phoneNumberDiscoverability:
                  PhoneNumberDiscoverability.Discoverable,
              },
              workflow,
            });
          }}
        >
          {i18n('icu:StandaloneRegistration--ProfileEntry--continue')}
        </AxoButton.Root>
      </Buttons>
      <AxoDialog.Root
        open={isEditingAvatar}
        onOpenChange={open => {
          if (!open) {
            setIsEditingAvatar(false);
          }
        }}
      >
        <AxoDialog.Content size="sm" escape="cancel-is-destructive">
          <AxoDialog.Header>
            <AxoDialog.Title>
              {i18n(
                'icu:StandaloneRegistration--ProfileEntry--AvatarModal--header'
              )}
            </AxoDialog.Title>
            <AxoDialog.Close />
          </AxoDialog.Header>
          <AvatarEditor
            avatarColor={AvatarColors[0]}
            avatarUrl={undefined}
            avatarValue={avatarData}
            conversationId={conversationId}
            conversationTitle={fullName}
            deleteAvatarFromDisk={deleteAvatarFromDisk}
            i18n={i18n}
            isDisplayedAsPanel
            onCancel={() => {
              setIsEditingAvatar(false);
            }}
            onSave={(avatar: Uint8Array<ArrayBuffer> | undefined) => {
              setAvatarData(avatar);
              setIsEditingAvatar(false);
            }}
            userAvatarData={userAvatarData}
            replaceAvatar={replaceAvatar}
            saveAvatarToDisk={saveAvatarToDisk}
          />
        </AxoDialog.Content>
      </AxoDialog.Root>
    </Container>
  );
}
