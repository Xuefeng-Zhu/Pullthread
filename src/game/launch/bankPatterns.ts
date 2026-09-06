import type { ChallengeBand, ChallengePattern } from './challengeTypes';

/**
 * The centered thorn blocks every unbounced ascent into the return pocket.
 * A side cushion reverses horizontal travel above it. Both exit anchors leave
 * room for the next full pull; completing inputs and the continuous-path
 * occlusion certificate live only in test verification.
 */
const bands: readonly ChallengeBand[] = ['intro', 'mixed', 'expert'];

export const BANK_PATTERNS: readonly ChallengePattern[] = bands.flatMap((band) => [
  {
    id: `bank-return-${band}`,
    family: 'bank',
    band,
    entryX: { min: 100, max: 100 },
    exitX: { min: 100, max: 100 },
    receiver: { center: { x: 100, y: -232 }, width: 144 },
    bumpers: [{ center: { x: 284, y: -260 }, radius: 48, restitution: 0.95 }],
    hazards: [{ center: { x: 100, y: -104 }, radius: 14 }],
    cue: 'Pull away from the cushion. Bounce back above the thorns.',
  },
  {
    id: `bank-rise-${band}`,
    family: 'bank',
    band,
    entryX: { min: 100, max: 100 },
    exitX: { min: 100, max: 100 },
    receiver: { center: { x: 100, y: -240 }, width: 144 },
    bumpers: [{ center: { x: 280, y: -265 }, radius: 48, restitution: 1 }],
    hazards: [{ center: { x: 100, y: -108 }, radius: 16 }],
    cue: 'Aim higher on the cushion to return over the thorns.',
  },
]);
