import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { usePreferencesStore } from '../../store/usePreferencesStore';
import { ExpoMusicService } from './ExpoMusicService';

/** Keeps one music player mounted while the app navigates between screens. */
export function AppMusic() {
  const musicEnabled = usePreferencesStore((state) => state.musicEnabled);
  const initialMusicEnabled = useRef(musicEnabled);
  const serviceRef = useRef<ExpoMusicService | null>(null);

  useEffect(() => {
    const service = new ExpoMusicService();
    serviceRef.current = service;
    service.setAppActive(AppState.currentState === 'active');
    service.setEnabled(initialMusicEnabled.current);

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      service.setAppActive(state === 'active');
    });

    const unlock = () => service.unlockFromUserGesture();
    const webDocument = Platform.OS === 'web' && typeof document !== 'undefined'
      ? document
      : null;

    webDocument?.addEventListener('pointerdown', unlock, true);
    webDocument?.addEventListener('keydown', unlock, true);

    return () => {
      webDocument?.removeEventListener('pointerdown', unlock, true);
      webDocument?.removeEventListener('keydown', unlock, true);
      appStateSubscription.remove();
      service.dispose();
      serviceRef.current = null;
    };
  }, []);

  useEffect(() => {
    serviceRef.current?.setEnabled(musicEnabled);
  }, [musicEnabled]);

  return null;
}
