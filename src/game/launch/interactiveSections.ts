import type { AnchorRange } from './challengeTypes';
import { INTERACTIVE_MECHANICS, obstacleBudget, type InteractiveIntroduction, type InteractiveMechanic } from './interactiveProgression';
import { worldStageForScore } from './progression';
import { mirrorSection, type SectionFamily, type SectionPattern } from './sections';
import type { LaunchBarrier, LaunchPocket, LaunchSwitch } from './types';

export interface InteractiveSectionPattern extends SectionPattern {
  readonly mechanics: readonly InteractiveMechanic[];
  readonly introduction?: InteractiveIntroduction;
  readonly barriers: readonly LaunchBarrier[];
  readonly switches: readonly LaunchSwitch[];
}

const barrier = (id: string, x: number, y: number, width: number,
  kind: LaunchBarrier['kind'] = 'solid', phaseTicks = 0): LaunchBarrier =>
  ({ id, x, y, width, height: 12, kind, ...(kind === 'shutter' ? { phaseTicks } : {}) });
const receiver = (id: string, x: number, y: number, ascentRank: number,
  route: LaunchPocket['route'], width = 116): LaunchPocket => ({ id, center: { x, y }, width,
  kind: 'checkpoint', ascentRank, route });
const links = [
  { from: 'entry', to: 'left' }, { from: 'entry', to: 'right' },
  { from: 'left', to: 'left-upper' }, { from: 'right', to: 'right-upper' },
  { from: 'left-upper', to: 'rest' }, { from: 'right-upper', to: 'rest' },
];
const upperWalls = [barrier('upper-middle', 122, -548, 116),
  barrier('upper-left', 0, -548, 42), barrier('upper-right', 318, -548, 42)];

function layout(id: string, variant: number, mechanics: readonly InteractiveMechanic[],
  barriers: readonly LaunchBarrier[], switches: readonly LaunchSwitch[] = [], introduction?: InteractiveIntroduction): InteractiveSectionPattern {
  const hoop = mechanics.includes('hoop');
  const leftX = [98, 102, 94][variant];
  const rightX = [262, 258, 266][variant];
  const pockets: LaunchPocket[] = [receiver('left', leftX, -130, 1, 'safe'),
    receiver('right', rightX, -140, 1, 'reward', introduction ? 116 : 104),
    receiver('left-upper', [98, 124, 78][variant], -400, 2, 'safe'),
    receiver('right-upper', [262, 236, 282][variant], -415, 2, 'reward', 116),
    receiver('rest', 180, -680, 3, 'recovery', 144)];
  if (hoop) pockets[1] = { ...pockets[1], width: 104,
    center: { x: 240, y: -140 },
    orbit: { radius: 48, periodTicks: 720, phaseTicks: variant * 240, direction: 1 } };
  const cue = introduction === 'hoop' ? 'The hoop keeps turning while you aim. Pull, follow its motion, then release.'
    : introduction === 'tear' ? 'Punch through the loose cloth with a strong pull. The tear stays open if you land below.'
      : introduction === 'switch' ? 'Hit the button to unzip the matching passage. It stays open for the climb.'
        : introduction === 'shutter' ? 'The striped shutter opens, warns, then closes. Release when the passage is clear.'
          : mechanics.length ? 'Choose your challenge. Read the cloth openings before you release.'
            : 'Thread the cloth corridors. Control your angle as well as your pull.';
  // The three shapes climb parallel lanes, converge through a central opening,
  // or fan outward into narrower side passages before the final recovery.
  const shapedBarriers = barriers.flatMap((value) => {
    if (variant === 1 && value.id === 'upper-middle') return [{ ...value, x: 0, width: 110 }];
    if (variant === 1 && value.id === 'upper-left') return [{ ...value, x: 250, width: 110 }];
    if (variant === 1 && value.id === 'upper-right') return [];
    if (variant === 2 && value.id === 'upper-middle') return [{ ...value, x: 108, width: 144 }];
    return [value];
  });
  return { id, family: mechanics.includes('shutter') ? 'gate' : mechanics.includes('tear') ? 'cushion' : 'fork',
    entryX: { min: 100, max: 260 }, exitX: { min: 180, max: 180 }, pockets, connections: links,
    exitPocketId: 'rest', bumpers: variant === 2 && !introduction
      ? [{ id: 'recovery-cushion', center: { x: 20, y: -604 }, radius: 18, restitution: 0.98 }] : [], hazards: [],
    pickups: [{ id: 'gift', kind: 'preview', center: { x: [262, 236, 282][variant], y: -439 }, radius: 17 }],
    mechanics, barriers: shapedBarriers, switches, ...(introduction ? { introduction } : {}), cue };
}

function sensor(id: string, pocketId: 'left' | 'right', variant: number, doorId: string, introductory: boolean): LaunchSwitch {
  const x = pocketId === 'left' ? [98, 102, 94][variant] : [262, 258, 266][variant];
  return { id, center: { x: x + (introductory ? 0 : pocketId === 'left' ? 32 : -32),
    y: pocketId === 'left' ? -174 : -184 }, radius: 20, doorIds: [doorId],
  ...(introductory ? { pocketId } : {}) };
}

function lesson(mechanic: InteractiveIntroduction, variant: number, introductory: boolean): InteractiveSectionPattern {
  const id = `${mechanic}-${introductory ? 'lesson' : 'course'}-${variant}`;
  const phase = variant * 160;
  if (mechanic === 'hoop') {
    const walls = [barrier('lower-left', 0, -267, introductory ? 24 : 52),
      barrier('lower-edge', introductory ? 124 : 118, -267, introductory ? 1 : 6), ...upperWalls,
      barrier('lower-far-left', 0, -281, 24)];
    return layout(id, variant, ['hoop'], introductory ? walls.slice(0, 3) : walls, [], introductory ? 'hoop' : undefined);
  }
  const kind = mechanic === 'tear' ? 'tearable' : mechanic === 'switch' ? 'door' : 'shutter';
  const walls = introductory
    ? [barrier('right-obstacle', 205, -267, 155, kind, phase), barrier('lower-middle', 130, -267, 75), ...upperWalls,
      barrier('lower-left', 0, -267, 24)]
    : [barrier('left-obstacle', 0, -267, 170, kind, phase), barrier('right-obstacle', 190, -267, 170, kind, phase + 120),
      barrier('lower-middle', 170, -267, 20), ...upperWalls];
  const switches = mechanic === 'switch' ? [
    ...(!introductory ? [sensor('left-button', 'left', variant, 'left-obstacle', false)] : []),
    sensor('right-button', 'right', variant, 'right-obstacle', introductory),
  ] : [];
  return layout(id, variant, [mechanic], introductory ? walls.slice(0, 3) : walls, switches, introductory ? mechanic : undefined);
}

export const INTERACTIVE_CORRIDORS: readonly InteractiveSectionPattern[] = [0, 1, 2].map((variant) => layout(`cloth-corridor-${variant}`, variant, [], [
  barrier('lower-middle', 122 + variant * 4, -267, 116 - variant * 8, 'thorns'), upperWalls[0],
  barrier('lower-left', 0, -267, 42 + variant * 3), barrier('lower-right', 318 - variant * 3, -267, 42 + variant * 3),
  ...upperWalls.slice(1),
]));
export const INTERACTIVE_LESSONS: readonly InteractiveSectionPattern[] = INTERACTIVE_MECHANICS.flatMap((mechanic) =>
  [0, 1, 2].map((variant) => lesson(mechanic, variant, true)));
export const INTERACTIVE_COURSES: readonly InteractiveSectionPattern[] = INTERACTIVE_MECHANICS.flatMap((mechanic) =>
  [0, 1, 2].map((variant) => lesson(mechanic, variant, false)));

export const INTERACTIVE_COMBINATIONS: readonly InteractiveSectionPattern[] = INTERACTIVE_MECHANICS.flatMap((first, index) =>
  INTERACTIVE_MECHANICS.slice(index + 1).map((second, offset) => {
    const variant = (index + offset) % 3;
    if (first === 'hoop') {
      const kind = second === 'tear' ? 'tearable' : second === 'switch' ? 'door' : 'shutter';
      return layout(`hoop-${second}-course`, variant, [first, second], [
        barrier('left-obstacle', 52, -267, 70, kind, variant * 160), barrier('lower-left', 0, -267, 52),
        ...upperWalls, barrier('lower-edge', 122, -267, 2),
      ], second === 'switch' ? [sensor('left-button', 'left', variant, 'left-obstacle', false)] : []);
    }
    const kinds = { tear: 'tearable', switch: 'door', shutter: 'shutter' } as const;
    const switches = [first, second].flatMap((mechanic, side) => mechanic === 'switch'
      ? [sensor(`${side ? 'right' : 'left'}-button`, side ? 'right' : 'left', variant, `${side ? 'right' : 'left'}-obstacle`, false)] : []);
    return layout(`${first}-${second}-course`, variant, [first, second], [
      barrier('left-obstacle', 0, -267, 170, kinds[first], variant * 160),
      barrier('right-obstacle', 190, -267, 170, kinds[second as Exclude<InteractiveIntroduction, 'hoop'>], variant * 160 + 120),
      barrier('lower-middle', 170, -267, 20), ...upperWalls,
    ], switches);
  }));

/** Includes full-density authored candidates; selection retains required mechanics first. */
export const INTERACTIVE_SECTION_PATTERNS = [...INTERACTIVE_CORRIDORS, ...INTERACTIVE_LESSONS, ...INTERACTIVE_COURSES, ...INTERACTIVE_COMBINATIONS];

export function mirrorInteractiveSection(pattern: InteractiveSectionPattern): InteractiveSectionPattern {
  const mirrored = mirrorSection(pattern);
  return { ...pattern, ...mirrored, pockets: mirrored.pockets.map((pocket, index) => ({ ...pocket,
    ...(pattern.pockets[index].orbit ? { orbit: { ...pattern.pockets[index].orbit!,
      phaseTicks: (pattern.pockets[index].orbit!.periodTicks / 2 - pattern.pockets[index].orbit!.phaseTicks
        + pattern.pockets[index].orbit!.periodTicks) % pattern.pockets[index].orbit!.periodTicks,
      direction: -(pattern.pockets[index].orbit!.direction ?? 1) as 1 | -1 } } : {}),
  })), barriers: pattern.barriers.map((value) => ({ ...value, x: 360 - value.x - value.width })),
  switches: pattern.switches.map((value) => ({ ...value, center: { x: 360 - value.center.x, y: value.center.y } })) };
}

function randomWord(seed: number, index: number): number {
  let word = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  word = Math.imul(word ^ (word >>> 16), 0x85ebca6b);
  word = Math.imul(word ^ (word >>> 13), 0xc2b2ae35);
  return (word ^ (word >>> 16)) >>> 0;
}

export function chooseInteractiveSection(seed: number, index: number, entry: AnchorRange,
  _previousFamily: SectionFamily | undefined, score: number, introductions: readonly number[]): InteractiveSectionPattern {
  const word = randomWord(seed, index);
  const stage = Math.min(4, worldStageForScore(score));
  const pending = INTERACTIVE_MECHANICS.findIndex((_, mechanic) => mechanic < stage && introductions[mechanic] < 3);
  let pattern: InteractiveSectionPattern;
  if (pending !== -1) pattern = INTERACTIVE_LESSONS[pending * 3 + introductions[pending]];
  else if (stage === 0 || word % 3 === 0) pattern = INTERACTIVE_CORRIDORS[(word >>> 6) % 3];
  else {
    const combinations = INTERACTIVE_COMBINATIONS.filter((candidate) => candidate.mechanics.every((mechanic) => {
      const index = INTERACTIVE_MECHANICS.indexOf(mechanic as InteractiveIntroduction);
      return index < stage && introductions[index] === 3;
    }));
    const courses = INTERACTIVE_COURSES.filter((candidate) => INTERACTIVE_MECHANICS.indexOf(candidate.mechanics[0] as InteractiveIntroduction) < stage);
    const candidates = score >= 100 || (stage >= 2 && word % 4 === 0) ? combinations : courses;
    pattern = (candidates.length ? candidates : courses)[(word >>> 8) % (candidates.length || courses.length)];
  }
  if (entry.min < pattern.entryX.min || entry.max > pattern.entryX.max) throw new Error(`No interactive section accepts ${entry.min}..${entry.max}`);
  const [minimum, maximum] = obstacleBudget(score);
  const density = pattern.introduction ? pattern.barriers.length
    : Math.min(pattern.barriers.length, minimum + ((word >>> 12) & 1), maximum);
  pattern = { ...pattern, barriers: pattern.barriers.slice(0, density) };
  if (score >= 60 && pattern.id === 'cloth-corridor-2') pattern = { ...pattern, family: 'fray', mechanics: ['fray'],
    pockets: pattern.pockets.map((pocket) => pocket.id === 'right-upper' ? { ...pocket, frayTicks: 480 } : pocket),
    cue: 'Thread the narrow side passage. The upper loose pocket lasts four seconds.' };
  if (maximum === 0) {
    const heights: Record<string, number> = { left: -125, right: -145, 'left-upper': -255, 'right-upper': -280, rest: -410 };
    pattern = { ...pattern, id: `${pattern.id}-warmup`, bumpers: [], pockets: pattern.pockets.map((pocket) => ({ ...pocket,
      center: { ...pocket.center, y: heights[pocket.id] } })),
    pickups: pattern.pickups.map((pickup) => ({ ...pickup, center: { ...pickup.center, y: -304 } })) };
  }
  return word & 0x100 ? mirrorInteractiveSection(pattern) : pattern;
}
