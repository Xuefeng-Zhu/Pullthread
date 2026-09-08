import type { AnchorRange } from './challengeTypes';
import { chooseSection, mirrorSection, SECTION_PATTERNS, type SectionFamily, type SectionPattern } from './sections';
import type { LaunchWindZone } from './types';
import { INTRODUCED_MECHANICS, worldStageForScore, type IntroducedMechanic, type WorldMechanic } from './progression';

export { INTRODUCED_MECHANICS } from './progression';
export interface WorldSectionPattern extends SectionPattern {
  readonly mechanics: readonly WorldMechanic[];
  readonly introduction?: IntroducedMechanic;
  readonly windZones: readonly LaunchWindZone[];
}

const basic = (pattern: SectionPattern): WorldSectionPattern => ({ ...pattern,
  mechanics: pattern.family === 'gate' || pattern.family === 'fray' ? [pattern.family] : [], windZones: [] });

function sway(pattern: WorldSectionPattern): WorldSectionPattern {
  return { ...pattern, id: `${pattern.id}-sway`, mechanics: [...pattern.mechanics, 'sway'],
    pockets: pattern.pockets.map((pocket) => pocket.route === 'reward'
      ? { ...pocket, width: 104, center: { ...pocket.center, x: Math.min(264, Math.max(96, pocket.center.x)) },
        motion: { amplitude: 22, periodTicks: 480, phaseTicks: 0 } } : pocket) };
}

function windy(pattern: WorldSectionPattern): WorldSectionPattern {
  return { ...pattern, id: `${pattern.id}-wind`, mechanics: [...pattern.mechanics, 'wind'],
    windZones: [{ id: 'ribbon', x: 210, y: -310, width: 100, height: 150, accelerationX: -100 }] };
}

const swayPatterns = [0, 1, 3].map((index) => ({ ...sway(basic(SECTION_PATTERNS[index])),
  // The lesson contains only its new interaction; cushions return in mixed sections.
  bumpers: [], family: 'fork' as const, cue: 'The garden pockets sway. Catch one to hold it still, or take the wide lane.' }));
const windPatterns = [0, 1, 4].map((index) => ({ ...windy(basic(SECTION_PATTERNS[index])),
  bumpers: [], family: 'fork' as const, cue: 'Wind ribbons carry your button sideways. The wide lane stays sheltered.' }));
const springPatterns = [3, 4, 5].map((index) => ({ ...basic(SECTION_PATTERNS[index]),
  id: `${SECTION_PATTERNS[index].id}-spring`, mechanics: ['spring'] as const,
  bumpers: SECTION_PATTERNS[index].bumpers.map((bumper) => ({ ...bumper, radius: 26, springSpeed: 650 })),
  cue: 'Spring spools send the button bouncing farther. Try a bank, or use the wide pockets.' }));
const scissorsPatterns = [0, 80, 160].map((phaseTicks, index) => ({ ...basic(SECTION_PATTERNS[7]),
  id: `scissors-window-${index}`, mechanics: ['scissors'] as const,
  hazards: [{ id: 'scissors', center: { x: 250, y: -258 }, radius: 18, visual: 'scissors' as const,
    motion: { axis: 'x' as const, amplitude: 34, periodTicks: 600, phaseTicks } }],
  cue: 'Wait for the scissors to sweep past, then launch. The wide lane has no timing gate.' }));

/** Authoring order is part of generation v3; historical v2 layouts stay in sections.ts. */
export const WORLD_SECTION_PATTERNS: readonly WorldSectionPattern[] = [
  ...swayPatterns, ...windPatterns, ...springPatterns, ...scissorsPatterns,
  { ...sway(windPatterns[0]), cue: 'Ride the ribbon toward a swaying landing, or climb the sheltered pockets.' },
  { ...sway(springPatterns[0]), cue: 'Bank off a spring toward a swaying pocket, or follow the roomy lane.' },
  { ...sway(scissorsPatterns[0]), cue: 'Watch the scissors and the moving landing before taking the reward lane.' },
  { ...windy(basic(SECTION_PATTERNS[9])), cue: 'Ride the ribbon to loose stitches, then launch again before they unravel.' },
];

export function mirrorWorldSection(pattern: WorldSectionPattern): WorldSectionPattern {
  return { ...pattern, ...mirrorSection(pattern), windZones: pattern.windZones.map((zone) => ({
    ...zone, x: 360 - zone.x - zone.width, accelerationX: -zone.accelerationX,
  })) };
}

function randomWord(seed: number, index: number): number {
  let word = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  word = Math.imul(word ^ (word >>> 16), 0x85ebca6b);
  word = Math.imul(word ^ (word >>> 13), 0xc2b2ae35);
  return (word ^ (word >>> 16)) >>> 0;
}

/** Reserve lessons at generation time, never change a section already visible ahead. */
export function chooseWorldSection(seed: number, index: number, entry: AnchorRange,
  previousFamily: SectionFamily | undefined, score: number, introductions: readonly number[]): WorldSectionPattern {
  const stage = Math.min(4, worldStageForScore(score));
  const pending = INTRODUCED_MECHANICS.findIndex((_, mechanic) => mechanic < stage && introductions[mechanic] < 3);
  const pressureBefore = previousFamily === 'gate' || previousFamily === 'fray';
  const word = randomWord(seed, index);
  if (pending !== -1 && !pressureBefore) {
    const lesson = WORLD_SECTION_PATTERNS[pending * 3 + introductions[pending]];
    const pattern = { ...lesson, introduction: INTRODUCED_MECHANICS[pending] };
    return word & 0x100 ? mirrorWorldSection(pattern) : pattern;
  }
  const baseline = basic(chooseSection(seed, index, entry, previousFamily, score >= 12));
  // A calm section after pressure preserves time to understand the next lesson.
  if (pending !== -1 || stage === 0 || word % 3 === 0) return baseline;
  const eligible = WORLD_SECTION_PATTERNS.filter((pattern) =>
    pattern.entryX.min <= entry.min && pattern.entryX.max >= entry.max
    && pattern.family !== previousFamily
    && (!pressureBefore || (pattern.family !== 'gate' && pattern.family !== 'fray'))
    && pattern.mechanics.every((mechanic) => {
      const introduced = INTRODUCED_MECHANICS.indexOf(mechanic as IntroducedMechanic);
      return introduced === -1 || (introduced < stage && introductions[introduced] === 3);
    }));
  const combinations = eligible.filter((pattern) => pattern.mechanics.length === 2);
  const candidates = score >= 100 && word % 3 === 1 && combinations.length ? combinations : eligible;
  if (!candidates.length) return baseline;
  const selected = candidates[word % candidates.length];
  return word & 0x100 ? mirrorWorldSection(selected) : selected;
}
