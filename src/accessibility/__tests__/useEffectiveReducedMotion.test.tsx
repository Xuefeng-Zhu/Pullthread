import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  resetPreferencesStoreForTests,
  usePreferencesStore,
} from '../../store/usePreferencesStore';
import { useEffectiveReducedMotion } from '../useEffectiveReducedMotion';

describe('useEffectiveReducedMotion', () => {
  beforeEach(async () => {
    await resetPreferencesStoreForTests();
    jest.restoreAllMocks();
  });

  test('follows the app preference when the OS preference is off', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    const view = await renderHook(() => useEffectiveReducedMotion());

    expect(view.result.current).toBe(false);

    await act(() => {
      usePreferencesStore.getState().setReducedMotionEnabled(true);
    });

    expect(view.result.current).toBe(true);
  });

  test('keeps reduced motion on when requested by the OS', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const view = await renderHook(() => useEffectiveReducedMotion());

    await waitFor(() => expect(view.result.current).toBe(true));

    await act(() => {
      usePreferencesStore.getState().setReducedMotionEnabled(false);
    });
    expect(view.result.current).toBe(true);
  });
});
