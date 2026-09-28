// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  actions,
  getEmptyState,
  reducer,
} from '../../../state/ducks/linkPreviews.preload.ts';
import type { LinkPreviewForUIType } from '../../../types/message/LinkPreviews.std.ts';

describe('both/state/ducks/linkPreviews', () => {
  function getMockLinkPreview(): LinkPreviewForUIType {
    return {
      title: 'Hello World',
      domain: 'swarm.green',
      image: undefined,
      url: 'https://swarm.green',
      isStickerPack: false,
      isCallLink: false,
    };
  }

  describe('addLinkPreview', () => {
    const { addLinkPreview } = actions;

    it('updates linkPreview', () => {
      const state = getEmptyState();
      const linkPreview = getMockLinkPreview();
      const nextState = reducer(state, addLinkPreview(linkPreview, 1));

      assert.deepEqual(nextState.linkPreview, linkPreview);
    });
  });

  describe('removeLinkPreview', () => {
    const { removeLinkPreview } = actions;

    it('removes linkPreview', () => {
      const state = {
        ...getEmptyState(),
        linkPreview: getMockLinkPreview(),
      };
      const nextState = reducer(state, removeLinkPreview());

      assert.isUndefined(nextState.linkPreview);
    });
  });
});
