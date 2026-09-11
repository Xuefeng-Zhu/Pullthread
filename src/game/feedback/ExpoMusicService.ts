import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioSource,
} from 'expo-audio';
import { Platform } from 'react-native';

const musicSource = require('../../../assets/audio/playful-climb-loop.wav') as AudioSource;

const audioMode = {
  allowsRecording: false,
  interruptionMode: 'mixWithOthers',
  playsInSilentMode: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
} as const;

/**
 * Owns Pullthread's one long-lived music player. Playback is best effort so an
 * unavailable or interrupted audio session can never block the app shell.
 */
export class ExpoMusicService {
  private player: AudioPlayer | null = null;
  private enabled = false;
  private appActive = true;
  private webUnlocked = Platform.OS !== 'web';
  private audioSetup: Promise<boolean> | null = null;
  private disposed = false;

  constructor() {
    try {
      this.player = createAudioPlayer(musicSource, {
        updateInterval: 1_000,
      });
      this.player.loop = true;
      // The track is mastered at a restrained level so this can stay at full
      // volume on browsers that do not support programmatic volume changes.
      this.player.volume = 1;
    } catch {
      this.player = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncPlayback();
  }

  setAppActive(active: boolean): void {
    this.appActive = active;
    this.syncPlayback();
  }

  /** Call directly from a browser input event to satisfy autoplay policies. */
  unlockFromUserGesture(): void {
    if (Platform.OS !== 'web' || this.disposed) {
      return;
    }

    this.webUnlocked = true;
    this.syncPlayback(true);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    try {
      this.player?.pause();
      this.player?.remove();
    } catch {
      // Audio cleanup is allowed to fail during app teardown.
    }

    this.player = null;
  }

  private shouldPlay(): boolean {
    return (
      !this.disposed &&
      this.enabled &&
      this.appActive &&
      (Platform.OS !== 'web' || this.webUnlocked)
    );
  }

  private syncPlayback(forceWebAttempt = false): void {
    const player = this.player;

    if (!player || this.disposed) {
      return;
    }

    if (!this.shouldPlay()) {
      if (player.playing) {
        try {
          player.pause();
        } catch {
          // Interrupted players can already be unavailable.
        }
      }
      return;
    }

    if (Platform.OS === 'web') {
      // Expo's web player cannot surface a rejected HTMLMediaElement promise.
      // Retrying from later gestures is harmless and covers a denied first try.
      if (forceWebAttempt || !player.playing) {
        try {
          player.play();
        } catch {
          // A later pointer or keyboard gesture will retry playback.
        }
      }
      return;
    }

    void this.ensureAudioReady().then((ready) => {
      if (!ready || !this.shouldPlay() || this.player?.playing) {
        return;
      }

      try {
        this.player?.play();
      } catch {
        // Native playback remains best effort.
      }
    });
  }

  private ensureAudioReady(): Promise<boolean> {
    if (this.audioSetup) {
      return this.audioSetup;
    }

    this.audioSetup = setAudioModeAsync(audioMode)
      .then(() => true)
      .catch(() => {
        this.audioSetup = null;
        return false;
      });

    return this.audioSetup;
  }
}
