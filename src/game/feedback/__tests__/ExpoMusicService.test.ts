import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import { Platform } from 'react-native';

import { ExpoMusicService } from '../ExpoMusicService';

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}));

const mockedCreateAudioPlayer = jest.mocked(createAudioPlayer);
const mockedSetAudioModeAsync = jest.mocked(setAudioModeAsync);

function makePlayer() {
  const player = {
    currentTime: 0,
    loop: false,
    pause: jest.fn(),
    play: jest.fn(),
    playing: false,
    remove: jest.fn(),
    volume: 0,
  };
  player.play.mockImplementation(() => {
    player.playing = true;
  });
  player.pause.mockImplementation(() => {
    player.playing = false;
  });
  return player;
}

async function flushAudioSetup() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ExpoMusicService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSetAudioModeAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loops one native player and resumes without seeking', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoMusicService();

    service.setEnabled(true);
    await flushAudioSetup();

    expect(mockedCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(player.loop).toBe(true);
    expect(player.volume).toBe(1);
    expect(player.play).toHaveBeenCalledTimes(1);

    player.currentTime = 7.5;
    service.setAppActive(false);
    service.setAppActive(true);
    await flushAudioSetup();

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(player.currentTime).toBe(7.5);
  });

  it('keeps the Music preference independent and retries audio setup', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    mockedSetAudioModeAsync.mockRejectedValueOnce(new Error('audio unavailable'));
    const service = new ExpoMusicService();

    service.setEnabled(true);
    await flushAudioSetup();
    expect(player.play).not.toHaveBeenCalled();

    service.setEnabled(false);
    service.setEnabled(true);
    await flushAudioSetup();
    expect(mockedSetAudioModeAsync).toHaveBeenCalledTimes(2);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('waits for a browser gesture and pauses while inactive', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoMusicService();

    service.setEnabled(true);
    expect(player.play).not.toHaveBeenCalled();

    service.unlockFromUserGesture();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(mockedSetAudioModeAsync).not.toHaveBeenCalled();

    service.setAppActive(false);
    expect(player.pause).toHaveBeenCalledTimes(1);
    service.setAppActive(true);
    expect(player.play).toHaveBeenCalledTimes(2);

    service.unlockFromUserGesture();
    expect(player.play).toHaveBeenCalledTimes(3);
  });

  it('stops and releases its player exactly once', async () => {
    const player = makePlayer();
    mockedCreateAudioPlayer.mockReturnValue(player as unknown as AudioPlayer);
    const service = new ExpoMusicService();

    service.setEnabled(true);
    await flushAudioSetup();
    service.dispose();
    service.dispose();
    service.setEnabled(true);

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.remove).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('absorbs player construction failures', () => {
    mockedCreateAudioPlayer.mockImplementation(() => {
      throw new Error('player unavailable');
    });

    expect(() => {
      const service = new ExpoMusicService();
      service.setEnabled(true);
      service.dispose();
    }).not.toThrow();
  });
});
