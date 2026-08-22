import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { usePreferencesStore } from '../store/usePreferencesStore';

/** The app may add reduced motion, but never turns an enabled OS setting off. */
export function useEffectiveReducedMotion(): boolean {
  const userPreference = usePreferencesStore(
    (state) => state.reducedMotionEnabled,
  );
  const [systemPreference, setSystemPreference] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setSystemPreference(enabled);
      })
      .catch(() => {
        // Accessibility queries are best effort on unsupported runtimes.
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setSystemPreference,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return userPreference || systemPreference;
}
