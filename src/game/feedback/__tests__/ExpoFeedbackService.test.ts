import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { ExpoFeedbackService } from '../ExpoFeedbackService';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

const mockedCreateAudioPlayer = jest.mocked(createAudioPlayer);
const mockedSetAudioModeAsync = jest.mocked(setAudioModeAsync);
const mockedHaptics = jest.mocked(Haptics);

const makePlayer = () => ({
  currentTime: 0,
  pause: jest.fn(),
  play: jest.fn(),
  playing: false,
  remove: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  volume: 1,
});

describe('ExpoFeedbackService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSetAudioModeAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('plays the sound and mapped haptic for a completed stitch', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoFeedbackService();

    await service.play('stitchComplete');

    expect(mockedSetAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    expect(mockedCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(mockedHaptics.impactAsync).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );
  });

  it('keeps sound and haptic preferences independent', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoFeedbackService({ soundEnabled: false });

    await service.play('success');

    expect(mockedCreateAudioPlayer).not.toHaveBeenCalled();
    expect(mockedHaptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );

    service.setPreferences({ hapticsEnabled: false, soundEnabled: true });
    await service.play('success');

    expect(mockedCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockedHaptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('skips Expo Audio on web while preserving haptic feedback', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const service = new ExpoFeedbackService();

    await service.play('success');

    expect(mockedSetAudioModeAsync).not.toHaveBeenCalled();
    expect(mockedCreateAudioPlayer).not.toHaveBeenCalled();
    expect(mockedHaptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  it('rewinds an existing player before replaying a cue', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoFeedbackService();

    await service.play('buttonClick');
    player.currentTime = 0.04;
    player.playing = true;
    await service.play('buttonClick');

    expect(mockedCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it('absorbs native feedback failures', async () => {
    mockedSetAudioModeAsync.mockRejectedValueOnce(new Error('audio unavailable'));
    mockedHaptics.impactAsync.mockRejectedValueOnce(
      new Error('haptics unavailable'),
    );
    const service = new ExpoFeedbackService();

    await expect(service.play('stitchComplete')).resolves.toBeUndefined();
    expect(mockedCreateAudioPlayer).not.toHaveBeenCalled();
  });

  it('pauses sounds when disabled and releases players on disposal', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoFeedbackService();

    await service.play('travelerRoll');
    service.setPreferences({ soundEnabled: false });
    service.dispose();
    await service.play('travelerRoll');

    expect(player.pause).toHaveBeenCalledTimes(2);
    expect(player.remove).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });
});
