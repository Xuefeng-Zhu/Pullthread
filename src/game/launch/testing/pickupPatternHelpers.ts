/** Test-only optional-route verification using the real input clamp, camera, and sweeps. */
import type { ChallengePattern } from '../challengeTypes';
import { createLegacyEndlessRun as createEndlessRun, launchEndless, stepEndless, type EndlessRun } from '../endless';
import { clampEndlessPull } from '../launchInput';
import { pickupPlacement } from '../pickups';
import { createLaunchState } from '../simulation';
import type { LaunchPoint } from '../types';
import { bankWitness } from './bankPatternVerification';
import { aimAtReceiver, patternRoom } from './flightPatternHelpers';

function createPickupPatternRun(pattern: ChallengePattern, entryX: number, placement = pickupPlacement(pattern)) {
  const run = createEndlessRun(0);
  run.room = { ...patternRoom(pattern, entryX), pickups: [{ ...placement, id: 'endless-pickup-1', kind: 'preview' }] };
  run.state = createLaunchState(run.room);
  run.cameraY = -480;
  // Keep the authored collider window intact on either source or receiver recatches.
  // No unrelated generated geometry is introduced into this isolated fixture.
  run.nextPocketIndex = 1_000;
  run.challenges = [{ index: 1, pocketId: 'endless-1', patternId: pattern.id,
    family: pattern.family, band: pattern.band,
    bumperIds: run.room.bumpers.map((bumper) => bumper.id),
    hazardIds: run.room.hazards.map((hazard) => hazard.id), pickupIds: ['endless-pickup-1'] }];
  return run;
}
function fly(run: EndlessRun, pull: LaunchPoint) {
  const launched = launchEndless(run, clampEndlessPull(pull, run.state.position, run.cameraY, run.room.bounds));
  let collected = false;
  let bounces = 0;
  for (let tick = 0; tick < 960 && run.state.phase === 'flying'; tick += 1) {
    const events = stepEndless(run);
    collected ||= events.some((event) => event.type === 'pickup' && event.id === 'endless-pickup-1');
    bounces += events.filter((event) => event.type === 'bounce').length;
  }
  return { launched, pocketId: run.state.pocketId, phase: run.state.phase, collected, bounces, failure: run.state.failure };
}
export function flyPickupPattern(pattern: ChallengePattern, pull: LaunchPoint, entryX = pattern.entryX.min,
  placement = pickupPlacement(pattern)) {
  const result = fly(createPickupPatternRun(pattern, entryX, placement), pull);
  return { ...result, caught: result.phase === 'held' && result.pocketId === 'endless-1' };
}

/** All witness selection is confined to verification code; live routes never use it. */
export function pickupBypassWitness(pattern: ChallengePattern, entryX = pattern.entryX.min): LaunchPoint {
  if (pattern.family === 'bank') return bankWitness(pattern.id);
  const direction = pattern.receiver.center.x > 180 ? 1 : -1;
  const power = pattern.family === 'arc' ? 72 : pattern.band === 'expert' ? 78.5 : 76;
  const bias = (pattern.band === 'expert' ? -19 : pattern.band === 'mixed' ? -20 : -24) * direction;
  return aimAtReceiver({ ...pattern, receiver: { ...pattern.receiver,
    center: { ...pattern.receiver.center, x: pattern.receiver.center.x + bias } } }, entryX, power);
}

/** Optional side hop, then bank; or roomy arrival, then optional side hop. */
export function flyOptionalPickupRoute(pattern: ChallengePattern, entryX: number, offset: LaunchPoint) {
  const run = createPickupPatternRun(pattern, entryX);
  const detourAnchor = pattern.family === 'bank' ? entryX : pattern.receiver.center.x;
  const detour = { x: (detourAnchor < 180 ? 8 : -8) + offset.x, y: 42 + offset.y };
  const witness = pickupBypassWitness(pattern, entryX);
  const through = { x: witness.x + offset.x, y: witness.y + offset.y };
  const pulls = pattern.family === 'bank' ? [detour, through] : [through, detour];
  const flights = pulls.map((pull, index) => {
    if (index > 0) for (let tick = 0; tick < 120; tick += 1) stepEndless(run);
    return fly(run, pull);
  });
  return { flights, caught: run.state.phase === 'held' && run.state.pocketId === 'endless-1',
    collected: flights.some((flight) => flight.collected),
    count: run.inventory.preview, pocketsCaught: run.pocketsCaught };
}
