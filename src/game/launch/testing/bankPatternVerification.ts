import type { ChallengePattern } from '../challengeTypes';
import { BUTTON_RADIUS, LAUNCH_POWER, MAX_PULL } from '../simulation';
import type { LaunchPoint } from '../types';

/** Finger translation, before the normal maximum-stretch clamp. Never used in play. */
export function bankWitness(patternId: string): LaunchPoint {
  const x = patternId.startsWith('bank-return-') ? -30
    : patternId.startsWith('bank-rise-') ? -28 : undefined;
  if (x === undefined) throw new Error(`Missing bank witness for ${patternId}`);
  return { x: patternId.endsWith('-mirror') ? -x : x, y: 112 };
}

/**
 * Continuous no-bounce certificate, stronger than sampling a grid of pulls.
 *
 * Let p be vertical stretch, k launch power, and g gravity. An unbounced
 * trajectory has y(t)=p(1-kt)+gt²/2 and x(t)=anchorX+pullX(1-kt).
 * Negative p starts at most MAX_PULL above the anchor and travels downward.
 * A positive p that reaches the receiver must be at least minimumPullY below.
 * Its ascending thorn crossing is no later than maximumThornCrossingTime;
 * its descending receiver crossing is no earlier than minimumApexTime.
 * Therefore its thorn-crossing X lies within receiverHalfWidth*ratio of
 * the common source/receiver X. The inflated thorn covers that entire interval.
 */
export function bankOcclusionCertificate(pattern: ChallengePattern) {
  if (pattern.receiver.motion || pattern.entryX.min !== pattern.entryX.max
    || pattern.receiver.center.x !== pattern.entryX.min) {
    throw new Error('This certificate requires a fixed, same-column return pocket.');
  }
  const thorn = pattern.hazards[0];
  if (!thorn || thorn.center.x !== pattern.entryX.min) throw new Error('Missing centered blocking thorn.');
  const gravity = 700;
  const rise = -pattern.receiver.center.y;
  const thornRise = -thorn.center.y;
  const coefficient = LAUNCH_POWER ** 2 / (2 * gravity);
  const minimumPullY = (1 + Math.sqrt(1 + 4 * coefficient * rise)) / (2 * coefficient);
  const minimumSpeed = minimumPullY * LAUNCH_POWER;
  const minimumApexTime = minimumSpeed / gravity;
  const maximumThornCrossingTime = (minimumSpeed
    - Math.sqrt(minimumSpeed ** 2 - 2 * gravity * (minimumPullY + thornRise))) / gravity;
  const ratio = (LAUNCH_POWER * maximumThornCrossingTime - 1)
    / (LAUNCH_POWER * minimumApexTime - 1);
  // One world pixel is conservative for a 120Hz swept chord: its vertical
  // sag is <0.007px here and the thorn crossing is far below the apex.
  const maximumCrossingOffset = (pattern.receiver.width / 2 - BUTTON_RADIUS * 0.35) * ratio + 1;
  return {
    rise, thornRise, minimumPullY, minimumApexTime, maximumThornCrossingTime, ratio,
    maximumCrossingOffset,
    blockingMargin: thorn.radius + BUTTON_RADIUS - maximumCrossingOffset,
    maximumUnbouncedRise: coefficient * MAX_PULL ** 2 - MAX_PULL,
  };
}
