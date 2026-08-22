import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioSource,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import {
  defaultFeedbackPreferences,
  type FeedbackCue,
  type FeedbackPreferences,
  type FeedbackService,
} from './FeedbackService';

const audioSources = {
  fabricTouch: require('../../../assets/audio/cloth-rustle.wav'),
  threadDraw: require('../../../assets/audio/thread-draw.wav'),
  stitchComplete: require('../../../assets/audio/stitch-pluck.wav'),
  travelerRelease: require('../../../assets/audio/button-click.wav'),
  travelerRoll: require('../../../assets/audio/traveler-roll.wav'),
  buttonClick: require('../../../assets/audio/button-click.wav'),
  success: require('../../../assets/audio/success.wav'),
  failure: require('../../../assets/audio/failure.wav'),
} satisfies Partial<Record<FeedbackCue, AudioSource>>;

const soundVolumes = {
  fabricTouch: 0.32,
  threadDraw: 0.28,
  stitchComplete: 0.55,
  travelerRelease: 0.42,
  travelerRoll: 0.24,
  buttonClick: 0.38,
  success: 0.5,
  failure: 0.42,
} satisfies Partial<Record<FeedbackCue, number>>;

/**
 * Expo SDK 57 feedback implementation. Native effects are intentionally
 * best-effort: a missing device capability or interrupted audio session is a
 * no-op rather than a gameplay error.
 */
export class ExpoFeedbackService implements FeedbackService {
  private currentPreferences: FeedbackPreferences;
  private readonly players = new Map<FeedbackCue, AudioPlayer>();
  private audioSetup: Promise<boolean> | null = null;
  private disposed = false;

  constructor(preferences: Partial<FeedbackPreferences> = {}) {
    this.currentPreferences = {
      ...defaultFeedbackPreferences,
      ...preferences,
    };
  }

  get preferences(): FeedbackPreferences {
    return this.currentPreferences;
  }

  setPreferences(preferences: Partial<FeedbackPreferences>): void {
    const wasSoundEnabled = this.currentPreferences.soundEnabled;

    this.currentPreferences = {
      ...this.currentPreferences,
      ...preferences,
    };

    if (wasSoundEnabled && !this.currentPreferences.soundEnabled) {
      this.pauseAllSounds();
    }
  }

  async play(cue: FeedbackCue): Promise<void> {
    if (this.disposed) {
      return;
    }

    const effects: Promise<void>[] = [];

    if (this.currentPreferences.hapticsEnabled) {
      effects.push(this.playHaptic(cue));
    }

    // Browser autoplay policies reject programmatic effects until a user
    // gesture. Keep web silent so feedback never creates noisy console errors.
    if (this.currentPreferences.soundEnabled && Platform.OS !== 'web') {
      effects.push(this.playSound(cue));
    }

    await Promise.allSettled(effects);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const player of this.players.values()) {
      try {
        player.pause();
        player.remove();
      } catch {
        // Feedback cleanup must not interfere with screen/app teardown.
      }
    }

    this.players.clear();
  }

  private async playHaptic(cue: FeedbackCue): Promise<void> {
    switch (cue) {
      case 'fabricTouch':
      case 'threadTick':
      case 'buttonClick':
        await Haptics.selectionAsync();
        break;
      case 'stitchComplete':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'travelerRelease':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'success':
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        break;
      case 'failure':
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        );
        break;
      case 'threadDraw':
      case 'travelerRoll':
        break;
    }
  }

  private async playSound(cue: FeedbackCue): Promise<void> {
    const source = audioSources[cue as keyof typeof audioSources];

    if (source === undefined || !(await this.ensureAudioReady())) {
      return;
    }

    let player = this.players.get(cue);

    if (!player) {
      player = createAudioPlayer(source);
      player.volume = soundVolumes[cue as keyof typeof soundVolumes] ?? 0.4;
      this.players.set(cue, player);
    } else if (player.playing || player.currentTime > 0) {
      await player.seekTo(0);
    }

    player.play();
  }

  private ensureAudioReady(): Promise<boolean> {
    if (this.audioSetup) {
      return this.audioSetup;
    }

    this.audioSetup = setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    })
      .then(() => true)
      .catch(() => {
        this.audioSetup = null;
        return false;
      });

    return this.audioSetup;
  }

  private pauseAllSounds(): void {
    for (const player of this.players.values()) {
      try {
        player.pause();
      } catch {
        // A released/interrupted native player is safe to ignore.
      }
    }
  }
}
