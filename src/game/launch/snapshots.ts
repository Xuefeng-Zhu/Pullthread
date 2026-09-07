import type { EndlessRun, EndlessWorldSnapshot } from './endless';

/** Copy arrays and every mutable point/state record; immutable definitions remain plain data. */
function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyData) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyData(item)])) as T;
  }
  return value;
}

export function captureEndlessWorld(run: EndlessRun): EndlessWorldSnapshot {
  const { inventory: _inventory, reviveUsed: _reviveUsed, previewActive: _previewActive,
    collectedPickupIds: _collectedPickupIds, lastCatchSnapshot: _lastCatchSnapshot, ...world } = run;
  return copyData(world);
}

export function cloneEndlessRun(run: EndlessRun): EndlessRun {
  return copyData(run);
}

export function restoreEndlessWorld(run: EndlessRun, snapshot: EndlessWorldSnapshot): void {
  Object.assign(run, copyData(snapshot));
}

/** Journal payloads encode open-world infinite bounds without JSON's null coercion. */
export function serializeEndlessRun(run: EndlessRun): string {
  return JSON.stringify({ version: 1, run }, (_key, value: unknown) => {
    if (typeof value !== 'number' || Number.isFinite(value)) return value;
    if (Number.isNaN(value)) throw new Error('A run with NaN values cannot be saved.');
    return { $launchNumber: value < 0 ? '-Infinity' : 'Infinity' };
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function nonnegativeInteger(value: unknown): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}
function point(value: unknown): boolean {
  return record(value) && finite(value.x) && finite(value.y);
}
function idList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 64 && value.every((id) => typeof id === 'string');
}

function validWorld(value: unknown): boolean {
  if (!record(value) || !record(value.room) || !record(value.state)) return false;
  const { room, state } = value;
  if (!record(room.bounds) || room.bounds.width !== 360 || room.bounds.height !== 600
    || !finite(room.gravity) || !finite(value.cameraY)
    || !nonnegativeInteger(value.seed) || !nonnegativeInteger(value.highestPocket)
    || !nonnegativeInteger(value.pocketsCaught) || !finite(value.height)
    || !nonnegativeInteger(value.nextPocketIndex) || !finite(value.lastGeneratedY)
    || typeof value.nextPocketId !== 'string' || typeof value.lastPatternId !== 'string'
    || !record(value.lastExitX) || !finite(value.lastExitX.min) || !finite(value.lastExitX.max)
    || value.nextPocketIndex <= value.highestPocket || value.nextPocketIndex > value.highestPocket + 6
    || value.pocketsCaught > value.highestPocket || value.lastExitX.min > value.lastExitX.max
    || !['opening', 'recovery', 'arc', 'bank', 'reverse', 'timing'].includes(String(value.lastFamily))
    || !Array.isArray(value.challenges) || value.challenges.length > 32
    || !value.challenges.every((challenge) => record(challenge) && nonnegativeInteger(challenge.index)
      && typeof challenge.pocketId === 'string' && typeof challenge.patternId === 'string'
      && idList(challenge.bumperIds) && idList(challenge.hazardIds) && idList(challenge.pickupIds))) return false;
  if (room.bounds.top !== Number.NEGATIVE_INFINITY && !finite(room.bounds.top)) return false;
  if (!finite(room.bounds.bottom)) return false;
  if (!Array.isArray(room.pockets) || !room.pockets.length || room.pockets.length > 32
    || !room.pockets.every((pocket) => record(pocket) && typeof pocket.id === 'string'
      && point(pocket.center) && finite(pocket.width) && pocket.width > 0
      && ['start', 'checkpoint', 'goal'].includes(String(pocket.kind))
      && (pocket.motion === undefined || (record(pocket.motion) && finite(pocket.motion.amplitude)
        && finite(pocket.motion.periodTicks) && pocket.motion.periodTicks > 0 && finite(pocket.motion.phaseTicks))))) return false;
  for (const key of ['bumpers', 'hazards', 'pickups']) {
    const objects = room[key];
    if (key === 'pickups' && objects === undefined) continue;
    if (!Array.isArray(objects) || objects.length > 64 || !objects.every((object) => record(object)
      && typeof object.id === 'string' && point(object.center) && finite(object.radius) && object.radius > 0
      && (key !== 'bumpers' || finite(object.restitution))
      && (key !== 'pickups' || ['preview', 'teleport', 'revive'].includes(String(object.kind))))) return false;
  }
  return nonnegativeInteger(state.tick) && ['held', 'flying', 'failed', 'complete'].includes(String(state.phase))
    && point(state.position) && point(state.previousPosition) && point(state.velocity)
    && typeof state.pocketId === 'string' && room.pockets.some((pocket) => pocket.id === state.pocketId)
    && nonnegativeInteger(state.flightTicks) && nonnegativeInteger(state.launches)
    && record(state.checkpoint) && typeof state.checkpoint.pocketId === 'string'
    && nonnegativeInteger(state.checkpoint.tick) && idList(state.pickupIds)
    && typeof state.patchCollected === 'boolean' && typeof state.checkpoint.patchCollected === 'boolean'
    && typeof state.sourcePocketImmune === 'boolean';
}

export function deserializeEndlessRun(serialized: string): EndlessRun | null {
  try {
    const payload: unknown = JSON.parse(serialized, (_key, value: unknown) => {
      if (record(value) && Object.keys(value).length === 1) {
        if (value.$launchNumber === '-Infinity') return Number.NEGATIVE_INFINITY;
        if (value.$launchNumber === 'Infinity') return Number.POSITIVE_INFINITY;
      }
      return value;
    });
    if (!record(payload) || payload.version !== 1 || !validWorld(payload.run) || !record(payload.run)) return null;
    const run = payload.run;
    const inventory = run.inventory;
    if (!record(inventory) || !['preview', 'teleport', 'revive'].every((kind) => nonnegativeInteger(inventory[kind]))
      || typeof run.reviveUsed !== 'boolean' || typeof run.previewActive !== 'boolean'
      || !idList(run.collectedPickupIds) || !validWorld(run.lastCatchSnapshot)) return null;
    const checkpoint = run.lastCatchSnapshot;
    if (!record(checkpoint) || ['inventory', 'reviveUsed', 'previewActive', 'collectedPickupIds', 'lastCatchSnapshot']
      .some((key) => key in checkpoint)) return null;
    return run as unknown as EndlessRun;
  } catch {
    return null;
  }
}
