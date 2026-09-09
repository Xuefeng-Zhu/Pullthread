/** Development/test authoring only. Never import this from the app's runtime. */
import { launchEndless, nextEndlessChallenge, stepEndless, type EndlessRun } from '../endless';
import { clampEndlessPull } from '../launchInput';
import { LAUNCH_HZ, LAUNCH_POWER, pocketPosition } from '../simulation';
import type { LaunchEvent, LaunchPoint } from '../types';
import { bankWitness } from './bankPatternVerification';
import { cloneEndlessRun } from '../snapshots';
import { solveSectionEdge, type SectionInput } from './sectionSolver';

export interface RouteInput { readonly waitTicks: number; readonly pull: LaunchPoint; readonly setup?: readonly SectionInput[] }

export function cloneRun(run: EndlessRun): EndlessRun {
  return cloneEndlessRun(run);
}

export function replayNext(run: EndlessRun, input: RouteInput): LaunchEvent[] {
  const events: LaunchEvent[] = [];
  for (const setup of input.setup ?? []) {
    events.push(...replayNext(run, setup));
    if (run.state.phase !== 'held') return events;
  }
  for (let tick = 0; tick < input.waitTicks; tick += 1) stepEndless(run);
  const pull = clampEndlessPull(input.pull, run.state.position, run.cameraY, run.room.bounds);
  if (!launchEndless(run, pull)) return events;
  for (let tick = 0; tick < 1200 && run.state.phase === 'flying'; tick += 1) events.push(...stepEndless(run));
  return events;
}

export function ballisticPull(run: EndlessRun, power: number, waitTicks = 0, targetId = run.nextPocketId): LaunchPoint | undefined {
  const source = run.state.position;
  const target = run.room.pockets.find((pocket) => pocket.id === targetId)!;
  const rise = source.y - target.center.y;
  const speed = power * LAUNCH_POWER;
  const discriminant = speed * speed - 2 * run.room.gravity * (power + rise);
  if (discriminant <= 0) return;
  const seconds = (speed + Math.sqrt(discriminant)) / run.room.gravity;
  const targetX = pocketPosition(target, run.state.tick + waitTicks + seconds * LAUNCH_HZ).x;
  const x = (targetX - source.x) / (1 - LAUNCH_POWER * seconds);
  return Math.hypot(x, power) <= 100 ? { x, y: power } : undefined;
}

export function findNextInput(run: EndlessRun): RouteInput {
  if ((run.generationVersion ?? 1) >= 2) return findTargetInput(run, run.nextPocketId);
  const challenge = nextEndlessChallenge(run);
  const target = run.room.pockets.find((pocket) => pocket.id === run.nextPocketId)!;
  const period = target.motion?.periodTicks ?? 1;
  const preferred = challenge?.patternId.includes('arc-high') ? [91, 89, 90, 93, 87]
    : challenge?.family === 'opening' ? [72, 82]
      : challenge?.family === 'recovery' ? [76, 78, 80]
        : challenge?.family === 'timing' ? [86, 88, 90, 84]
          : [72, 76, 82, 86, 90];
  for (let waitTicks = 0; waitTicks < period; waitTicks += 12) {
    const pulls: LaunchPoint[] = challenge?.family === 'bank'
      ? [bankWitness(challenge.patternId)]
      : [...preferred, ...Array.from({ length: 24 }, (_, index) => 52 + index * 2)]
        .map((power) => ballisticPull(run, power, waitTicks)).filter((pull): pull is LaunchPoint => !!pull);
    for (const pull of pulls) {
      const attempt = cloneRun(run);
      const events = replayNext(attempt, { waitTicks, pull });
      if (attempt.state.phase === 'held' && attempt.state.pocketId === target.id
        && (challenge?.family !== 'bank' || events.some((event) => event.type === 'bounce'))) return { waitTicks, pull };
    }
  }
  throw new Error(`No completing input for seed${run.seed} pocket${run.nextPocketId} ${challenge?.patternId} at tick${run.state.tick} anchor${run.state.position.x},${run.state.position.y}`);
}

/** Search the actual assembled run, including adjacent sections and the scrolling floor. */
export function findTargetInput(run: EndlessRun, targetId: string): RouteInput {
  if ((run.generationVersion ?? 1) >= 4) {
    const input = solveSectionEdge(run.room, run.state, targetId, { perturbation: 0 });
    const attempt = cloneRun(run);
    replayNext(attempt, input);
    if (attempt.state.phase === 'held' && attempt.state.pocketId === targetId) return input;
    throw new Error(`Authored input failed in assembled v4 run ${run.seed}: ${run.state.pocketId} -> ${targetId}`);
  }
  const target = run.room.pockets.find((pocket) => pocket.id === targetId)!;
  const period = Math.max(target.motion?.periodTicks ?? 1,
    ...run.room.hazards.filter((hazard) => Math.abs(hazard.center.y - run.state.position.y) < 500)
      .map((hazard) => hazard.motion?.periodTicks ?? 1));
  const deadline = run.state.pocketExpiryTicks?.[run.state.pocketId];
  const waitLimit = Math.min(period, deadline === undefined ? period : deadline - run.state.tick);
  for (let waitTicks = 0; waitTicks < waitLimit; waitTicks += 24) {
    for (const power of [64, 72, 80, 88, 94, 98, 60, 68, 76, 84, 90, 96, 100]) {
      const center = ballisticPull(run, power, waitTicks, targetId);
      if (!center) continue;
      for (const offset of [0, -2, 2, -5, 5]) {
        const pull = { x: center.x + offset, y: center.y };
        const attempt = cloneRun(run);
        replayNext(attempt, { pull, waitTicks });
        if (attempt.state.phase === 'held' && attempt.state.pocketId === targetId) return { pull, waitTicks };
      }
    }
    if (run.room.windZones?.length || run.room.bumpers.some((bumper) => bumper.springSpeed)) {
      for (let power = 62; power <= 98; power += 3) for (let x = -62; x <= 62; x += 3) {
        const pull = { x, y: power };
        if (Math.hypot(x, power) > 100) continue;
        const attempt = cloneRun(run);
        replayNext(attempt, { pull, waitTicks });
        if (attempt.state.phase === 'held' && attempt.state.pocketId === targetId) return { pull, waitTicks };
      }
    }
  }
  throw new Error(`No route for seed ${run.seed} from ${run.state.pocketId} to ${targetId} at tick ${run.state.tick}`);
}
