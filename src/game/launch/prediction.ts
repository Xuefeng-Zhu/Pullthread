import { launchEndless, stepEndless, type EndlessRun } from './endless';
import { clampEndlessPull } from './launchInput';
import { cloneEndlessRun } from './snapshots';
import type { LaunchFailure, LaunchPoint } from './types';

export interface LaunchPrediction {
  readonly points: readonly LaunchPoint[];
  readonly bounces: readonly (LaunchPoint & { readonly tick: number; readonly id: string })[];
  readonly outcome: 'catch' | 'fail' | 'horizon' | 'invalid';
  readonly pocketId?: string;
  readonly failure?: LaunchFailure;
  readonly ticks: number;
  /** True means the flight continues beyond the eight-second prediction window. */
  readonly horizon: boolean;
}

/** A copy uses the real collision order, moving targets and scrolling failure floor. */
export function predictEndlessLaunch(run: EndlessRun, rawPull: LaunchPoint): LaunchPrediction {
  const attempt = cloneEndlessRun(run);
  const points: LaunchPoint[] = [];
  const bounces: (LaunchPoint & { tick: number; id: string })[] = [];
  const pull = clampEndlessPull(rawPull, attempt.state.position, attempt.cameraY, attempt.room.bounds);
  if (!launchEndless(attempt, pull)) return { points, bounces, outcome: 'invalid', ticks: 0, horizon: false };
  points.push({ ...attempt.state.position });
  let ticks = 0;
  while (ticks < 960 && attempt.state.phase === 'flying') {
    const events = stepEndless(attempt);
    ticks += 1;
    const bounced = events.filter((event) => event.type === 'bounce');
    bounced.forEach((event) => bounces.push({ ...attempt.state.position, tick: event.tick, id: event.id }));
    if (ticks % 4 === 0 || bounced.length || events.some((event) => event.type === 'catch' || event.type === 'fail')) {
      points.push({ ...attempt.state.position });
    }
  }
  const phase = attempt.state.phase;
  return {
    points, bounces, ticks, horizon: phase === 'flying',
    outcome: phase === 'held' ? 'catch' : phase === 'failed' ? 'fail' : 'horizon',
    ...(phase === 'held' ? { pocketId: attempt.state.pocketId } : {}),
    ...(attempt.state.failure ? { failure: attempt.state.failure } : {}),
  };
}
