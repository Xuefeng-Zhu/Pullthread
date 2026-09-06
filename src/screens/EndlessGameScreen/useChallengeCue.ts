import { useCallback, useRef, useState } from 'react';

import type { ActiveChallenge } from '../../game/launch/challengeTypes';
import { MIN_PULL } from '../../game/launch/simulation';
import type { LaunchPoint } from '../../game/launch/types';

type CueFamily = 'bank' | 'timing';

/** Remounting the flight starts a fresh set of introductions for the new run. */
export function useChallengeCue(challenge: ActiveChallenge | undefined, heldPocketId: string, hints: boolean) {
  const [introduced, setIntroduced] = useState<Record<CueFamily, boolean>>({ bank: false, timing: false });
  const activePull = useRef<{ family: CueFamily; heldPocketId: string; receiverId: string } | null>(null);
  const family = challenge?.family === 'bank' || challenge?.family === 'timing' ? challenge.family : undefined;
  const receiverId = challenge?.pocketId;
  const cue = challenge?.cue;

  const beginCuePull = useCallback((accepted: boolean) => {
    activePull.current = accepted && hints && cue && family && receiverId
      ? { family, heldPocketId, receiverId } : null;
  }, [cue, family, heldPocketId, hints, receiverId]);

  const updateCuePull = useCallback((pull: LaunchPoint) => {
    const active = activePull.current;
    if (!hints || !active || active.heldPocketId !== heldPocketId || active.receiverId !== receiverId
      || Math.hypot(pull.x, pull.y) < MIN_PULL) return;
    setIntroduced((previous) => previous[active.family]
      ? previous : { ...previous, [active.family]: true });
  }, [heldPocketId, hints, receiverId]);

  const cancelCuePull = useCallback(() => { activePull.current = null; }, []);

  return {
    cue: hints && family && !introduced[family] ? cue : undefined,
    beginCuePull,
    updateCuePull,
    cancelCuePull,
  };
}
