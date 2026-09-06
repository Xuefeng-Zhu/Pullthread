/** @jest-environment node */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { waitFor } from '@testing-library/react-native';

import {
  ENDLESS_PROGRESS_STORAGE_KEY,
  ENDLESS_PROGRESS_STORAGE_VERSION,
  hydrateEndlessProgress,
  resetEndlessProgressStoreForTests,
  sanitizeEndlessProgress,
  useEndlessProgressStore,
} from '../useEndlessProgressStore';

function serializedScore(bestPockets: number, version = ENDLESS_PROGRESS_STORAGE_VERSION): string {
  return JSON.stringify({ state: { bestPockets }, version });
}

async function expectDurableScore(bestPockets: number) {
  await waitFor(async () => {
    expect(await AsyncStorage.getItem(ENDLESS_PROGRESS_STORAGE_KEY)).toBe(serializedScore(bestPockets));
  });
}

describe('persisted endless best score', () => {
  beforeEach(async () => {
    await resetEndlessProgressStoreForTests();
    jest.clearAllMocks();
  });

  test('shares startup hydration and restores the saved best before play', async () => {
    await AsyncStorage.setItem(ENDLESS_PROGRESS_STORAGE_KEY, serializedScore(17));
    jest.mocked(AsyncStorage.getItem).mockClear();
    await Promise.all([hydrateEndlessProgress(), hydrateEndlessProgress(), hydrateEndlessProgress()]);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(17);
    expect(useEndlessProgressStore.persist.hasHydrated()).toBe(true);
  });

  test('persists only the best-pocket count in its own versioned namespace', async () => {
    useEndlessProgressStore.getState().recordScore(12);
    await expectDurableScore(12);
    const saved = await AsyncStorage.getItem(ENDLESS_PROGRESS_STORAGE_KEY);
    await resetEndlessProgressStoreForTests();
    await AsyncStorage.setItem(ENDLESS_PROGRESS_STORAGE_KEY, saved!);
    await useEndlessProgressStore.persist.rehydrate();
    expect(useEndlessProgressStore.getState().bestPockets).toBe(12);
    expect(typeof useEndlessProgressStore.getState().recordScore).toBe('function');
  });

  test('lower, repeated and invalid run scores cannot downgrade or rewrite the best', async () => {
    useEndlessProgressStore.getState().recordScore(8);
    await expectDurableScore(8);
    jest.mocked(AsyncStorage.setItem).mockClear();
    for (const score of [0, 3, 8, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      useEndlessProgressStore.getState().recordScore(score);
    }
    expect(useEndlessProgressStore.getState().bestPockets).toBe(8);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('sanitizes malformed persisted values and migrates a valid earlier envelope', async () => {
    for (const value of [null, [], {}, { bestPockets: -3 }, { bestPockets: '12' }, { bestPockets: 1.5 }, { bestPockets: Number.NaN }]) {
      expect(sanitizeEndlessProgress(value)).toEqual({ bestPockets: 0 });
    }
    await AsyncStorage.setItem(ENDLESS_PROGRESS_STORAGE_KEY, serializedScore(23, 0));
    await useEndlessProgressStore.persist.rehydrate();
    expect(useEndlessProgressStore.getState().bestPockets).toBe(23);
    await expectDurableScore(23);
  });

  test('corrupt JSON and unavailable reads finish hydration with usable in-memory state', async () => {
    await AsyncStorage.setItem(ENDLESS_PROGRESS_STORAGE_KEY, '{broken-json');
    await useEndlessProgressStore.persist.rehydrate();
    expect(useEndlessProgressStore.persist.hasHydrated()).toBe(true);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(0);
    useEndlessProgressStore.getState().recordScore(6);
    await expectDurableScore(6);
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
    await useEndlessProgressStore.persist.rehydrate();
    expect(useEndlessProgressStore.getState().bestPockets).toBe(6);
    expect(useEndlessProgressStore.persist.hasHydrated()).toBe(true);
  });

  test('a failed startup read and a lower new run preserve and recover the existing durable best', async () => {
    await AsyncStorage.setItem(ENDLESS_PROGRESS_STORAGE_KEY, serializedScore(17));
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('transient read failure'));
    await useEndlessProgressStore.persist.rehydrate();
    expect(useEndlessProgressStore.getState().bestPockets).toBe(0);
    await expectDurableScore(17);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    useEndlessProgressStore.getState().recordScore(3);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(3);
    await waitFor(() => expect(useEndlessProgressStore.getState().bestPockets).toBe(17));
    await expectDurableScore(17);
    expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([, value]) => JSON.parse(value).state.bestPockets === 17)).toBe(true);
  });

  test('continued read failures defer writes while keeping new scores playable in memory', async () => {
    await AsyncStorage.setItem(ENDLESS_PROGRESS_STORAGE_KEY, serializedScore(17));
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('startup read failure'));
    await useEndlessProgressStore.persist.rehydrate();
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('recovery read failure'));
    useEndlessProgressStore.getState().recordScore(3);
    await hydrateEndlessProgress();
    expect(useEndlessProgressStore.getState().bestPockets).toBe(3);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await expectDurableScore(17);
    useEndlessProgressStore.getState().recordScore(22);
    await hydrateEndlessProgress();
    expect(useEndlessProgressStore.getState().bestPockets).toBe(22);
    await expectDurableScore(22);
  });

  test.each([[10, 20], [20, 10]])(
    'a late cached score %i and an in-flight run score %i reconcile to their maximum',
    async (cached, recorded) => {
      let release!: (value: string) => void;
      const read = new Promise<string>((resolve) => { release = resolve; });
      jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => read);
      const hydration = useEndlessProgressStore.persist.rehydrate();
      useEndlessProgressStore.getState().recordScore(recorded);
      release(serializedScore(cached));
      await hydration;
      expect(useEndlessProgressStore.getState().bestPockets).toBe(Math.max(cached, recorded));
      await expectDurableScore(Math.max(cached, recorded));
    },
  );

  test('serializes slow writes so an older best cannot finish after a newer best', async () => {
    const setItem = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    jest.mocked(AsyncStorage.setItem).mockImplementationOnce(async (name, value) => {
      await blocked;
      await setItem(name, value);
    });
    useEndlessProgressStore.getState().recordScore(5);
    useEndlessProgressStore.getState().recordScore(12);
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    release();
    await expectDurableScore(12);
    expect(jest.mocked(AsyncStorage.setItem).mock.calls.map(([, value]) => JSON.parse(value).state.bestPockets)).toEqual([5, 12]);
  });

  test('failed writes preserve the current best and allow later durable improvements', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
    useEndlessProgressStore.getState().recordScore(4);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(4);
    useEndlessProgressStore.getState().recordScore(9);
    await expectDurableScore(9);
    expect(useEndlessProgressStore.getState().bestPockets).toBe(9);
  });

  test('recording and resetting endless scores leave other game data untouched', async () => {
    const otherKeys = ['pullthread.campaign-progress', 'pullthread.preferences', 'pullthread.entitlements'];
    for (const key of otherKeys) await AsyncStorage.setItem(key, `preserved:${key}`);
    jest.mocked(AsyncStorage.setItem).mockClear();
    useEndlessProgressStore.getState().recordScore(11);
    await expectDurableScore(11);
    await resetEndlessProgressStoreForTests();
    expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([key]) => key === ENDLESS_PROGRESS_STORAGE_KEY)).toBe(true);
    for (const key of otherKeys) expect(await AsyncStorage.getItem(key)).toBe(`preserved:${key}`);
  });
});
