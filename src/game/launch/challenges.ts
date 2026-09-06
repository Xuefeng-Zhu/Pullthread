import { BANK_PATTERNS } from './bankPatterns';
import type { AnchorRange, ChallengeBand, ChallengeFamily, ChallengePattern } from './challengeTypes';
import { FLIGHT_PATTERNS } from './flightPatterns';

/** The same geometric reflection applies to sine motion, including its phase. */
export function mirrorChallenge(pattern: ChallengePattern): ChallengePattern {
  const flip = (point: { readonly x: number; readonly y: number }) => ({ x: 360 - point.x, y: point.y });
  const range = (value: AnchorRange) => ({ min: 360 - value.max, max: 360 - value.min });
  return {
    ...pattern, id: `${pattern.id}-mirror`, entryX: range(pattern.entryX), exitX: range(pattern.exitX),
    receiver: {
      ...pattern.receiver, center: flip(pattern.receiver.center),
      ...(pattern.receiver.motion ? { motion: { ...pattern.receiver.motion,
        phaseTicks: pattern.receiver.motion.phaseTicks + pattern.receiver.motion.periodTicks / 2 } } : {}),
    },
    bumpers: pattern.bumpers.map((bumper) => ({ ...bumper, center: flip(bumper.center) })),
    hazards: pattern.hazards.map((hazard) => ({ ...hazard, center: flip(hazard.center) })),
  };
}

export const CHALLENGE_PATTERNS: readonly ChallengePattern[] = [...FLIGHT_PATTERNS, ...BANK_PATTERNS]
  .flatMap((pattern) => [pattern, mirrorChallenge(pattern)]);

export function challengeRandom(seed: number, index: number, channel: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

export function challengeBand(index: number): ChallengeBand {
  return index < 7 ? 'intro' : index < 15 ? 'mixed' : 'expert';
}

// A low ceiling must be followed by a high bank: this keeps it clear of the
// next pocket's stretch envelope. Timing exits feed a broad low arc or recovery.
// Banks never feed high arcs: that arc's thorn would cross the returning flight.
const THREE_SHOT_BLOCKS: readonly (readonly ChallengeFamily[])[] = [
  ['arc', 'bank', 'timing'], ['timing', 'arc', 'bank'],
  ['reverse', 'bank', 'timing'], ['bank', 'reverse', 'timing'],
  ['reverse', 'arc', 'bank'], ['arc', 'reverse', 'bank'],
];
const FOUR_SHOT_BLOCKS: readonly (readonly ChallengeFamily[])[] = [
  ['reverse', 'arc', 'bank', 'timing'], ['reverse', 'timing', 'arc', 'bank'],
  ['arc', 'reverse', 'bank', 'timing'], ['bank', 'reverse', 'arc', 'timing'],
  ['timing', 'arc', 'bank', 'reverse'], ['arc', 'bank', 'reverse', 'timing'],
];

export function chooseChallenge(seed: number, index: number, entry: AnchorRange,
  previousFamily: ChallengeFamily, previousPatternId: string): ChallengePattern {
  const band = challengeBand(index);
  const recovery = index === 6 || (index <= 14 ? index > 6 && (index - 6) % 4 === 0 : (index - 14) % 5 === 0);
  let family: ChallengeFamily = 'recovery';
  if (!recovery) {
    const start = index < 7 ? 3 : index < 15 ? 7 + Math.floor((index - 7) / 4) * 4
      : 15 + Math.floor((index - 15) / 5) * 5;
    const blocks = index < 7 ? THREE_SHOT_BLOCKS.slice(0, 2)
      : index < 15 ? THREE_SHOT_BLOCKS : FOUR_SHOT_BLOCKS;
    family = blocks[Math.floor(challengeRandom(seed, start, 10) * blocks.length)][index - start];
  }
  const choices = CHALLENGE_PATTERNS.filter((pattern) => pattern.band === band && pattern.family === family
    && pattern.entryX.min <= entry.min + 1e-6 && pattern.entryX.max >= entry.max - 1e-6
    && (family !== 'arc' || pattern.id.includes(previousFamily === 'timing' ? 'arc-low' : 'arc-high'))
    // Capped timing introduces an overhead thorn. Its successor crosses away
    // from that column for every possible frozen catch position.
    && (!previousPatternId.startsWith('timing-expert-')
      || pattern.receiver.center.x === (previousPatternId.endsWith('-mirror') ? 100 : 260)));
  if (!choices.length) throw new Error(`No validated ${band}/${family} connector for ${entry.min}..${entry.max}`);
  return choices[Math.floor(challengeRandom(seed, index, 11) * choices.length)];
}
