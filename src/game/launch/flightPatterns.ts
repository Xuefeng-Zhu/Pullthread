import type { ChallengeBand, ChallengePattern } from './challengeTypes';

const bands: readonly ChallengeBand[] = ['intro', 'mixed', 'expert'];
const authored: ChallengePattern[] = [];

for (const [difficulty, band] of bands.entries()) {
  const add = (pattern: ChallengePattern) => authored.push(pattern);
  const fixedEntry = { min: 100, max: 100 };
  const fixedExit = { min: 260, max: 260 };

  // Broad connectors cover every possible frozen position of a moving receiver.
  add({
    id: `recovery-${band}-right`, family: 'recovery', band,
    entryX: { min: 100, max: 260 }, exitX: fixedExit,
    receiver: { center: { x: 260, y: -120 - difficulty * 10 }, width: 144 - difficulty * 12 },
    bumpers: [], hazards: [], cue: 'A roomy pocket. Take a breath and choose your next pull.',
  });

  // The low thorn blocks the ordinary shallow diagonal. A stronger, taller arc clears it.
  add({
    id: `arc-high-${band}-right`, family: 'arc', band,
    entryX: fixedEntry, exitX: fixedExit,
    receiver: { center: { x: 260, y: -130 - difficulty * 8 }, width: 128 - difficulty * 12 },
    bumpers: [],
    hazards: [{ center: { x: 170, y: -65 - difficulty * 4 }, radius: 30 + difficulty }],
    cue: 'Stretch deeper to arc above the thorns.',
  });

  // A shallow flight clears this overhead thorn. Its left offset also leaves the following
  // return bank clear; a centered ceiling would intersect that bank's outward ascent.
  add({
    id: `arc-low-${band}-right`, family: 'arc', band,
    entryX: { min: 100, max: 260 }, exitX: fixedExit,
    receiver: { center: { x: 260, y: -110 - difficulty * 5 }, width: 128 - difficulty * 10 },
    bumpers: [],
    hazards: [{ center: { x: 140, y: -222 - difficulty * 4 }, radius: 36 + difficulty * 2 }],
    cue: 'Keep this pull light. Slip underneath the high thorns.',
  });

  // Long diagonals alternate the horizontal aim after an arrival at either outside anchor.
  add({
    id: `reverse-flat-${band}-right`, family: 'reverse', band,
    entryX: fixedEntry, exitX: fixedExit,
    receiver: { center: { x: 260, y: -110 - difficulty * 12 }, width: 126 - difficulty * 12 },
    bumpers: [], hazards: [], cue: 'Turn your aim across the fabric toward the far pocket.',
  });

  add({
    id: `reverse-rise-${band}-right`, family: 'reverse', band,
    entryX: fixedEntry, exitX: fixedExit,
    receiver: { center: { x: 260, y: -158 - difficulty * 8 }, width: 128 - difficulty * 12 },
    bumpers: [], hazards: [], cue: 'Reach diagonally upward. This far pocket needs a deeper pull.',
  });

  const amplitude = 60 + difficulty * 6;
  const periodTicks = 480 - difficulty * 60;
  // The higher return layout changes both the required flight height and the initial travel direction.
  for (const phase of [0, periodTicks / 2]) {
    add({
      id: `timing-${band}-${phase === 0 ? 'outward' : 'return'}-right`, family: 'timing', band,
      entryX: fixedEntry,
      exitX: { min: 180 - amplitude, max: 180 + amplitude },
      receiver: {
        center: { x: 180, y: -(phase === 0 ? 140 : 160) - difficulty * 10 }, width: 100 - difficulty * 12,
        motion: { amplitude, periodTicks, phaseTicks: phase },
      },
      bumpers: [],
      // Expert receivers combine release timing with a visible limit on power.
      // Their next connector crosses toward the opposite side of this ceiling.
      hazards: difficulty === 2 ? [{
        center: { x: 100, y: phase === 0 ? -300 : -320 }, radius: 24,
      }] : [],
      cue: difficulty === 2 ? 'Keep the pull light, then time the moving pocket.'
        : 'Watch the pocket, then release as it moves into your arc.',
    });
  }
}

export const FLIGHT_PATTERNS: readonly ChallengePattern[] = authored;
