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
  selectHasFullGame,
  useEntitlementStore,
} from '../../../store/useEntitlementStore';
import {
  resetGameStoreForTests,
  useGameStore,
} from '../../../store/useGameStore';
import {
  QuiltMapScreen,
  type QuiltMapScreenProps,
} from '../QuiltMapScreen';

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {},
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: 'PURCHASE_CANCELLED_ERROR',
  },
}));

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

function completedThrough(order: number): Record<string, CampaignLevelProgress> {
  return Object.fromEntries(
    CAMPAIGN_LEVELS.slice(0, order).map((level) => [
      level.id,
      completedLevel(2),
    ]),
  );
}

async function showChapter(
  view: Awaited<ReturnType<typeof render>>,
  quiltId: string,
) {
  await fireEvent.press(view.getByTestId(`quilt-chapter-tab-${quiltId}`));
}

describe('QuiltMapScreen', () => {
  beforeEach(() => {
    resetGameStoreForTests();
    useEntitlementStore.setState({
      hasFullGame: false,
      debugOverride: null,
    });
    jest.clearAllMocks();
  });

  test('renders all three quilts and all fifteen levels one chapter at a time', async () => {
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);

    expect(view.getByTestId('quilt-map-screen')).toBeTruthy();
    expect(view.getByTestId('quilt-chapter-pager').props.horizontal).toBe(true);
    expect(view.getByTestId('quilt-chapter-pager').props.pagingEnabled).toBe(
      true,
    );
    expect(
      view.getByTestId('quilt-chapter-pager').props.onScrollEndDrag,
    ).toBeUndefined();
    for (const [index, quilt] of CAMPAIGN_QUILTS.entries()) {
      await showChapter(view, quilt.id);
      expect(view.getByTestId(`quilt-section-${quilt.id}`)).toBeTruthy();
      expect(
        view.getByTestId(`quilt-chapter-tab-${quilt.id}`).props
          .accessibilityState,
      ).toEqual({ selected: true });
      expect(view.getByTestId('quilt-page-status').props.accessibilityLabel).toBe(
        `${quilt.name}, chapter ${index + 1} of ${CAMPAIGN_QUILTS.length}`,
      );
      for (const level of CAMPAIGN_LEVELS.filter(
        (candidate) => candidate.quiltId === quilt.id,
      )) {
        expect(view.getByTestId(`level-node-${level.id}`)).toBeTruthy();
      }
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

  test('switches chapters by horizontal swipe and preserves paging on resize', async () => {
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);
    const viewport = view.getByTestId('quilt-pager-viewport');

    await fireEvent(viewport, 'layout', {
      nativeEvent: { layout: { width: 320, height: 600, x: 0, y: 0 } },
    });

    expect(view.getByTestId('quilt-chapter-pager').props.snapToInterval).toBe(
      320,
    );
    expect(
      view.getByTestId('quilt-page-bedroom-quilt').props.style,
    ).toContainEqual({ width: 320 });

    await fireEvent(
      view.getByTestId('quilt-chapter-pager'),
      'momentumScrollEnd',
      {
        nativeEvent: {
          contentOffset: { x: 320, y: 0 },
          layoutMeasurement: { width: 320, height: 600 },
        },
      },
    );

    expect(view.getByTestId('quilt-page-status').props.accessibilityLabel).toBe(
      'Attic Quilt, chapter 2 of 3',
    );
    expect(view.queryByTestId('quilt-page-bedroom-quilt')).toBeNull();
    expect(
      view.getByTestId('quilt-page-attic-quilt').props
        .accessibilityElementsHidden,
    ).toBe(false);
    expect(view.getByTestId('quilt-page-attic-quilt').props['aria-hidden']).toBe(
      false,
    );

    await fireEvent(viewport, 'layout', {
      nativeEvent: { layout: { width: 480, height: 600, x: 0, y: 0 } },
    });
    expect(view.getByTestId('quilt-chapter-pager').props.snapToInterval).toBe(
      480,
    );
    expect(
      view.getByTestId('quilt-page-attic-quilt').props.style,
    ).toContainEqual({ width: 480 });
  });

  test('opens the chapter containing the first incomplete level', async () => {
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(4),
    });
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);

    expect(view.getByTestId('quilt-page-status').props.accessibilityLabel).toBe(
      'Bedroom Quilt, chapter 1 of 3',
    );

    await showChapter(view, 'festival-quilt');
    await act(async () => {
      useCampaignProgressStore.setState({
        progressByLevel: completedThrough(5),
      });
    });

    expect(view.getByTestId('quilt-page-status').props.accessibilityLabel).toBe(
      'Attic Quilt, chapter 2 of 3',
    );

    await showChapter(view, 'bedroom-quilt');
    await act(async () => {
      useCampaignProgressStore.setState({
        progressByLevel: completedThrough(10),
      });
    });

    expect(view.getByTestId('quilt-page-status').props.accessibilityLabel).toBe(
      'Festival Quilt, chapter 3 of 3',
    );
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
    await showChapter(view, 'attic-quilt');
    expect(
      view.getByTestId(`level-patch-${collectibleLevel.id}`).props.children,
    ).toBe('PATCH FOUND');
    expect(
      view.getByTestId(`level-node-${collectibleLevel.id}`).props
        .accessibilityLabel,
    ).toContain('patch found');

    await showChapter(view, 'bedroom-quilt');
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

  test('opens Daily Scrap from the map without starting a campaign level', async () => {
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);
    const dailyButton = view.getByTestId('quilt-map-daily-scrap-button');

    expect(dailyButton.props.accessibilityRole).toBe('button');
    expect(dailyButton.props.accessibilityLabel).toBe(
      'Open today’s Daily Scrap challenge',
    );

    await fireEvent.press(dailyButton);

    expect(nav.navigate).toHaveBeenCalledWith('DailyScrap');
    expect(useGameStore.getState()).toMatchObject({
      activeLevelId: CAMPAIGN_LEVELS[0].id,
      activeSession: { kind: 'campaign' },
      phase: 'planning',
    });
  });

  test('opens the Full Atelier paywall when Level 7 is reached but locked', async () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(6),
    });
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);
    const node = view.getByTestId(`level-node-${levelSeven.id}`);

    expect(view.getByTestId(`level-state-${levelSeven.id}`).props.children).toBe(
      'ATELIER LOCKED',
    );
    expect(node.props.accessibilityState).toEqual({
      disabled: false,
      selected: false,
    });
    expect(node.props.accessibilityLabel).toContain(
      'opens the one-time unlock paywall',
    );
    expect(node.props.accessibilityHint).toBe(
      'Opens the Full Atelier one-time unlock.',
    );

    await fireEvent.press(node);

    expect(nav.navigate).toHaveBeenCalledWith('Paywall', {
      levelId: levelSeven.id,
    });
    expect(useGameStore.getState().activeLevelId).toBe(CAMPAIGN_LEVELS[0].id);
  });

  test('reacts to a mock entitlement unlock and makes reached Level 7 current', async () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    useCampaignProgressStore.setState({
      progressByLevel: completedThrough(6),
    });
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);

    await act(async () => {
      useEntitlementStore.getState().setDebugEntitlement(true);
    });

    expect(selectHasFullGame(useEntitlementStore.getState())).toBe(true);
    expect(view.getByTestId(`level-state-${levelSeven.id}`).props.children).toBe(
      'CURRENT',
    );
    expect(
      view.getByTestId(`level-node-${levelSeven.id}`).props.accessibilityState,
    ).toEqual({ disabled: false, selected: true });

    await fireEvent.press(view.getByTestId(`level-node-${levelSeven.id}`));

    expect(nav.navigate).toHaveBeenCalledWith('SpikeLevel', {
      levelId: levelSeven.id,
    });
    expect(useGameStore.getState().activeLevelId).toBe(levelSeven.id);
  });

  test('keeps Level 7 sequence-locked after purchase without prior progress', async () => {
    const levelSeven = CAMPAIGN_LEVELS[6];
    const nav = navigation();
    const view = await render(<QuiltMapScreen navigation={nav.value} />);
    await showChapter(view, 'attic-quilt');

    expect(view.getByTestId(`level-state-${levelSeven.id}`).props.children).toBe(
      'ATELIER LOCKED',
    );

    await act(async () => {
      useEntitlementStore.getState().setDebugEntitlement(true);
    });

    const node = view.getByTestId(`level-node-${levelSeven.id}`);
    expect(view.getByTestId(`level-state-${levelSeven.id}`).props.children).toBe(
      'LOCKED',
    );
    expect(node.props.accessibilityState).toEqual({
      disabled: true,
      selected: false,
    });
    expect(node.props.accessibilityHint).toBe(
      'Complete the previous level to unlock.',
    );

    await fireEvent.press(node);
    expect(nav.navigate).not.toHaveBeenCalled();
  });
});
