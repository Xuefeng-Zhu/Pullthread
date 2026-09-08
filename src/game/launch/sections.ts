import type { AnchorRange } from './challengeTypes';
import type { LaunchBumper, LaunchHazard, LaunchPickup, LaunchPocket } from './types';

export type SectionFamily = 'fork' | 'cushion' | 'gate' | 'fray';

/** Coordinates are relative to an entry at y=0; `entry` is a virtual connection source. */
export interface SectionPattern {
  readonly id: string;
  readonly family: SectionFamily;
  readonly entryX: AnchorRange;
  readonly exitX: AnchorRange;
  readonly pockets: readonly LaunchPocket[];
  readonly connections: readonly { readonly from: string; readonly to: string }[];
  readonly exitPocketId: string;
  readonly bumpers: readonly LaunchBumper[];
  readonly hazards: readonly LaunchHazard[];
  readonly pickups: readonly LaunchPickup[];
  readonly cue: string;
}

const pocket = (id: string, x: number, y: number, ascentRank: number,
  route: NonNullable<LaunchPocket['route']>, width = route === 'reward' ? 76 : route === 'recovery' ? 144 : 116,
  frayTicks?: number): LaunchPocket => ({ id, center: { x, y }, ascentRank, route, width, frayTicks, kind: 'checkpoint' });
const links = (...pairs: readonly [string, string][]) => pairs.map(([from, to]) => ({ from, to }));
const gift = (x: number, y: number, kind: LaunchPickup['kind'] = 'preview'): LaunchPickup =>
  ({ id: 'gift', kind, center: { x, y }, radius: 17 });
const cushion = (id: string, x: number, y: number, radius = 30): LaunchBumper =>
  ({ id, center: { x, y }, radius, restitution: 0.98 });
const gate = (id: string, x: number, y: number, amplitude: number, periodTicks: number, phaseTicks = 0): LaunchHazard =>
  ({ id, center: { x, y }, radius: 14, motion: { axis: 'x', amplitude, periodTicks, phaseTicks } });
const section = (id: string, family: SectionFamily, pockets: readonly LaunchPocket[],
  connections: SectionPattern['connections'], extras: Partial<Pick<SectionPattern, 'bumpers' | 'hazards' | 'pickups'>>,
  cue: string): SectionPattern => ({
  id, family, entryX: { min: 100, max: 260 }, exitX: { min: 180, max: 180 },
  pockets, connections, exitPocketId: 'rest', bumpers: [], hazards: [], pickups: [], ...extras, cue,
});

/** Twelve distinct route layouts. Mirroring is performed after deterministic selection. */
export const SECTION_PATTERNS: readonly SectionPattern[] = [
  section('fork-lanes', 'fork', [
    pocket('safe', 98, -125, 1, 'safe'), pocket('reward', 264, -125, 1, 'reward'),
    pocket('safe-upper', 105, -255, 2, 'safe'), pocket('reward-upper', 255, -270, 2, 'reward'),
    pocket('rest', 180, -405, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'safe-upper'], ['reward', 'reward-upper'],
    ['safe-upper', 'rest'], ['reward-upper', 'rest']), { pickups: [gift(255, -294)] },
  'Choose the roomy pockets, or follow the narrow lane for a free tool.'),
  section('fork-bridge', 'fork', [
    pocket('safe', 98, -130, 1, 'safe'), pocket('reward', 264, -155, 1, 'reward'),
    pocket('bridge', 180, -285, 2, 'safe', 124), pocket('rest', 180, -415, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'bridge'], ['reward', 'bridge'], ['bridge', 'rest']),
  { pickups: [gift(264, -179, 'teleport')] }, 'Two routes meet at the wide stitched bridge.'),
  section('fork-crossing', 'fork', [
    pocket('safe', 96, -140, 1, 'safe'), pocket('reward', 262, -115, 1, 'reward'),
    pocket('safe-upper', 252, -280, 2, 'safe'), pocket('reward-upper', 96, -260, 2, 'reward'),
    pocket('rest', 180, -410, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'safe-upper'], ['reward', 'reward-upper'],
    ['safe-upper', 'rest'], ['reward-upper', 'rest']), { pickups: [gift(96, -284)] },
  'Cross the threads: a long diagonal leads to the next landing.'),

  section('cushion-side-return', 'cushion', [
    pocket('safe', 96, -135, 1, 'safe'), pocket('reward', 260, -160, 1, 'reward', 88),
    pocket('rest', 180, -310, 2, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'rest'], ['reward', 'rest']),
  { bumpers: [cushion('side', 338, -202, 27)], pickups: [gift(266, -184)] },
  'The side cushion can bounce you back into the reward pocket.'),
  section('cushion-stair', 'cushion', [
    pocket('safe', 95, -125, 1, 'safe'), pocket('reward', 258, -145, 1, 'reward', 84),
    pocket('safe-upper', 98, -270, 2, 'safe'), pocket('reward-upper', 260, -300, 2, 'reward', 92),
    pocket('rest', 180, -445, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'safe-upper'], ['reward', 'reward-upper'],
    ['safe-upper', 'rest'], ['reward-upper', 'rest']),
  { bumpers: [cushion('lower', 339, -191, 25), cushion('upper', 337, -346, 26)], pickups: [gift(260, -324, 'teleport')] },
  'Follow the cushion staircase, or climb the wide pockets on the other side.'),
  section('cushion-switchback', 'cushion', [
    pocket('safe', 98, -130, 1, 'safe'), pocket('reward', 258, -150, 1, 'reward', 84),
    pocket('bridge', 103, -290, 2, 'safe', 128), pocket('rest', 180, -435, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'bridge'], ['reward', 'bridge'], ['bridge', 'rest']),
  { bumpers: [cushion('return', 337, -195, 27), cushion('opposite', 21, -331, 25)], pickups: [gift(258, -174)] },
  'Bounce toward the first reward, then turn toward the opposite cushion.'),

  section('gate-open-window', 'gate', [
    pocket('safe', 98, -120, 1, 'safe'), pocket('reward', 264, -120, 1, 'reward'),
    pocket('rest', 180, -390, 2, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'rest'], ['reward', 'rest']),
  { hazards: [gate('window', 230, -253, 45, 420)], pickups: [gift(264, -144, 'teleport')] },
  'Take a deep pull. Wait for the moving thorns to open your route.'),
  section('gate-two-lanes', 'gate', [
    pocket('safe', 94, -125, 1, 'safe'), pocket('reward', 265, -125, 1, 'reward'),
    pocket('safe-upper', 94, -390, 2, 'safe'), pocket('reward-upper', 265, -390, 2, 'reward'),
    pocket('rest', 180, -525, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'safe-upper'], ['reward', 'reward-upper'],
    ['safe-upper', 'rest'], ['reward-upper', 'rest']),
  { hazards: [gate('sweep', 250, -258, 62, 480, 80)], pickups: [gift(265, -414)] },
  'The wide lane is roomy. Time the thorn sweep for the tool above.'),
  section('gate-diagonal', 'gate', [
    pocket('safe', 100, -125, 1, 'safe'), pocket('reward', 264, -125, 1, 'reward'),
    pocket('bridge', 100, -390, 2, 'safe', 128), pocket('rest', 180, -525, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'bridge'], ['reward', 'bridge'], ['bridge', 'rest']),
  { hazards: [gate('crossbar', 242, -258, 48, 540, 160)], pickups: [gift(264, -149)] },
  'Watch the moving crossbar before taking the long diagonal.'),

  section('fray-shortcut', 'fray', [
    pocket('safe', 98, -120, 1, 'safe'), pocket('reward', 264, -150, 1, 'reward', 76, 480),
    pocket('rest', 180, -290, 2, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'rest'], ['reward', 'rest']),
  { pickups: [gift(264, -174, 'teleport')] },
  'Loose stitches last four seconds after landing. The wide route has no timer.'),
  section('fray-bridge', 'fray', [
    pocket('safe', 98, -130, 1, 'safe'), pocket('reward', 264, -130, 1, 'reward', 76, 480),
    pocket('bridge', 180, -260, 2, 'safe', 124), pocket('rest', 180, -390, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'bridge'], ['reward', 'bridge'], ['bridge', 'rest']),
  { pickups: [gift(264, -154)] }, 'Grab the gift on the loose pocket, then reach the untimed bridge.'),
  section('fray-relay', 'fray', [
    pocket('safe', 98, -125, 1, 'safe'), pocket('reward', 264, -125, 1, 'reward'),
    pocket('safe-upper', 104, -255, 2, 'safe'), pocket('reward-upper', 255, -275, 2, 'reward', 76, 480),
    pocket('rest', 180, -415, 3, 'recovery'),
  ], links(['entry', 'safe'], ['entry', 'reward'], ['safe', 'safe-upper'], ['reward', 'reward-upper'],
    ['safe-upper', 'rest'], ['reward-upper', 'rest']), { pickups: [gift(255, -299, 'teleport')] },
  'Choose your lane first. The second reward pocket starts a four-second countdown.'),
];

export function mirrorSection(pattern: SectionPattern): SectionPattern {
  const mirror = (point: { readonly x: number; readonly y: number }) => ({ x: 360 - point.x, y: point.y });
  return {
    ...pattern, id: `${pattern.id}-mirror`,
    entryX: { min: 360 - pattern.entryX.max, max: 360 - pattern.entryX.min },
    exitX: { min: 360 - pattern.exitX.max, max: 360 - pattern.exitX.min },
    pockets: pattern.pockets.map((value) => ({ ...value, center: mirror(value.center),
      motion: value.motion ? { ...value.motion, amplitude: -value.motion.amplitude } : undefined })),
    bumpers: pattern.bumpers.map((value) => ({ ...value, center: mirror(value.center) })),
    hazards: pattern.hazards.map((value) => ({ ...value, center: mirror(value.center),
      motion: value.motion ? { ...value.motion, amplitude: value.motion.axis === 'y' ? value.motion.amplitude : -value.motion.amplitude } : undefined })),
    pickups: pattern.pickups.map((value) => ({ ...value, center: mirror(value.center) })),
  };
}

function randomWord(seed: number, index: number): number {
  let word = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  word = Math.imul(word ^ (word >>> 16), 0x85ebca6b);
  word = Math.imul(word ^ (word >>> 13), 0xc2b2ae35);
  return (word ^ (word >>> 16)) >>> 0;
}

export function chooseSection(seed: number, index: number, entry: AnchorRange,
  previousFamily: SectionFamily | undefined, allowFray: boolean): SectionPattern {
  const teaching: readonly SectionFamily[] = ['fork', 'cushion', 'gate'];
  const isPressure = (family: SectionFamily) => family === 'gate' || family === 'fray';
  const eligible = SECTION_PATTERNS.filter((candidate) =>
    candidate.entryX.min <= entry.min && candidate.entryX.max >= entry.max
    && candidate.family !== previousFamily && (candidate.family !== 'fray' || allowFray)
    && (!previousFamily || !isPressure(previousFamily) || !isPressure(candidate.family))
    && (index >= teaching.length || candidate.family === teaching[index]));
  if (!eligible.length) throw new Error(`No section accepts entry ${entry.min}..${entry.max} at ${index}`);
  const word = randomWord(seed, index);
  const selected = eligible[word % eligible.length];
  return word & 0x100 ? mirrorSection(selected) : selected;
}
