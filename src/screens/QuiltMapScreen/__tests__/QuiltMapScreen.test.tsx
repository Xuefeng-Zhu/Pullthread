import { act, fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  CAMPAIGN_LEVELS,
  CAMPAIGN_QUILTS,
} from '../../../game/levels/campaignLevels';
import {
  useCampaignProgressStore,
  type CampaignLevelProgress,
} from '../../../store/useCampaignProgressStore';
import {
  QuiltMapScreen,
  type QuiltMapScreenProps,
} from '../QuiltMapScreen';

function completedLevel(
  thimbles: 1 | 2 | 3,
  collectedPatch = false,
): CampaignLevelProgress {
  return {
    completed: true,
    bestRun: {
      thimbles,
      metrics: {
        threadUsed: 72,
        stitchesUsed: 1,
        completionMs: 3_200,
        collectedPatch,
      },
    },
  };
}

function navigation() {
  const navigate = jest.fn();
  return {
    navigate,
    value: { navigate } as unknown as QuiltMapScreenProps['navigation'],
  };
}

describe('QuiltMapScreen', () => {
  beforeEach(() => {
    useCampaignProgressStore.setState({ progressByLevel: {} });
    jest.clearAllMocks();
  });

  test('renders all three quilts and all fifteen campaign levels', async () => {
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);

    expect(view.getByTestId('quilt-map-screen')).toBeTruthy();
    for (const quilt of CAMPAIGN_QUILTS) {
      expect(view.getByTestId(`quilt-section-${quilt.id}`)).toBeTruthy();
      expect(view.getByText(quilt.name)).toBeTruthy();
    }
    for (const level of CAMPAIGN_LEVELS) {
      expect(view.getByTestId(`level-node-${level.id}`)).toBeTruthy();
    }
    expect(view.getByTestId('quilt-thimble-total').props.children).toEqual([
      0,
      ' / ',
      32,
    ]);
    expect(view.getByTestId('quilt-patch-total').props.children).toEqual([
      0,
      ' / ',
      2,
    ]);
  });

  test('unlocks only the first incomplete level and blocks locked nodes', async () => {
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);
    const firstLevel = CAMPAIGN_LEVELS[0];
    const secondLevel = CAMPAIGN_LEVELS[1];

    expect(
      view.getByTestId(`level-node-${firstLevel.id}`).props.accessibilityState,
    ).toEqual({ disabled: false, selected: true });
    expect(view.getByTestId(`level-state-${firstLevel.id}`).props.children).toBe(
      'CURRENT',
    );
    expect(
      view.getByTestId(`level-node-${secondLevel.id}`).props.accessibilityState,
    ).toEqual({ disabled: true, selected: false });
    expect(
      view.getByTestId(`level-state-${secondLevel.id}`).props.children,
    ).toBe('LOCKED');

    await fireEvent.press(view.getByTestId(`level-node-${secondLevel.id}`));
    expect(nav.navigate).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId(`level-node-${firstLevel.id}`));
    expect(nav.navigate).toHaveBeenCalledWith('SpikeLevel', {
      levelId: firstLevel.id,
    });
  });

  test('advances sequentially and totals durable thimbles and patches', async () => {
    const firstLevel = CAMPAIGN_LEVELS[0];
    const secondLevel = CAMPAIGN_LEVELS[1];
    const collectibleLevel = CAMPAIGN_LEVELS.find(
      (level) => level.id === 'attic-10-hidden-patch',
    );
    if (!collectibleLevel) throw new Error('Expected collectible campaign level.');

    useCampaignProgressStore.setState({
      progressByLevel: {
        [firstLevel.id]: completedLevel(2),
        [collectibleLevel.id]: completedLevel(3, true),
      },
    });
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);

    expect(view.getByTestId(`level-state-${firstLevel.id}`).props.children).toBe(
      'COMPLETED',
    );
    expect(
      view.getByTestId(`level-node-${secondLevel.id}`).props.accessibilityState,
    ).toEqual({ disabled: false, selected: true });
    expect(view.getByTestId('quilt-thimble-total').props.children).toEqual([
      5,
      ' / ',
      32,
    ]);
    expect(view.getByTestId('quilt-patch-total').props.children).toEqual([
      1,
      ' / ',
      2,
    ]);
    expect(
      view.getByTestId(`level-patch-${collectibleLevel.id}`).props.children,
    ).toBe('PATCH FOUND');
    expect(
      view.getByTestId(`level-node-${collectibleLevel.id}`).props
        .accessibilityLabel,
    ).toContain('patch found');

    await fireEvent.press(view.getByTestId(`level-node-${secondLevel.id}`));
    expect(nav.navigate).toHaveBeenCalledWith('SpikeLevel', {
      levelId: secondLevel.id,
    });
  });

  test('reacts to progress updates and keeps Settings as a separate route', async () => {
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);
    const firstLevel = CAMPAIGN_LEVELS[0];
    const secondLevel = CAMPAIGN_LEVELS[1];

    await fireEvent.press(view.getByTestId('quilt-map-settings-button'));
    expect(nav.navigate).toHaveBeenCalledWith('Settings');

    await act(async () => {
      useCampaignProgressStore.setState({
        progressByLevel: { [firstLevel.id]: completedLevel(1) },
      });
    });

    expect(view.getByTestId(`level-state-${firstLevel.id}`).props.children).toBe(
      'COMPLETED',
    );
    expect(view.getByTestId(`level-state-${secondLevel.id}`).props.children).toBe(
      'CURRENT',
    );
    expect(
      view.getByTestId(`level-node-${secondLevel.id}`).props.accessibilityHint,
    ).toBe('Opens this level.');
  });
});
