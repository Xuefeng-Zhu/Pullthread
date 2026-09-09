import { isCreativeTool, type ToolKind } from '../../commerce/contracts';
import { parseToolUse, type ToolUse } from '../../commerce/toolUse';
import { activatePreview, eligibleTeleportPockets, ENDLESS_HEIGHT, reviveEndless, teleportEndless, type EndlessRun } from './endless';
import { BUTTON_RADIUS, hazardPosition, isPocketExpired, MAX_PULL, pocketPosition } from './simulation';
import { BOUNCE_PATCH_LENGTH, BOUNCE_PATCH_THICKNESS, effectivePockets, STITCH_POCKET_WIDTH } from './toolEffects';
import type { LaunchPoint, LaunchPocket } from './types';
import { spendFreeTool } from './toolInventory';

export { effectivePockets } from './toolEffects';
export { isCreativeTool } from '../../commerce/contracts';

function visible(run: EndlessRun, position: LaunchPoint, halfX = 0, halfY = 0): boolean {
  return position.x - halfX >= 0 && position.x + halfX <= run.room.bounds.width
    && position.y - halfY >= run.cameraY
    && position.y + halfY <= Math.min(run.cameraY + ENDLESS_HEIGHT, run.room.bounds.bottom ?? Infinity);
}

export function eligibleVelcroTargets(run: EndlessRun): readonly LaunchPocket[] {
  if (run.state.phase !== 'held') return [];
  return effectivePockets(run.room, run.state).filter((pocket) => pocket.id !== run.state.pocketId
    && !isPocketExpired(run.state, pocket)
    && !(run.state.stitchedPocket?.spent && run.state.stitchedPocket.pocket.id === pocket.id)
    && visible(run, pocketPosition(pocket, run.state.tick, run.state), pocket.width / 2, 14));
}

export function eligiblePinTargets(run: EndlessRun): readonly { id: string; position: LaunchPoint; label: string }[] {
  if (run.state.phase !== 'held') return [];
  return [
    ...eligibleVelcroTargets(run).filter((pocket) => pocket.motion || pocket.orbit)
      .map((pocket) => ({ id: pocket.id, position: pocketPosition(pocket, run.state.tick, run.state), label: 'Moving pocket' })),
    ...run.room.hazards.filter((hazard) => hazard.motion && visible(run, hazardPosition(hazard, run.state.tick, run.state), hazard.radius, hazard.radius))
      .map((hazard) => ({ id: hazard.id, position: hazardPosition(hazard, run.state.tick, run.state), label: hazard.visual === 'scissors' ? 'Moving scissors' : 'Moving thorns' })),
    ...run.room.barriers?.filter((barrier) => barrier.kind === 'shutter'
      && visible(run, { x: barrier.x + barrier.width / 2, y: barrier.y + barrier.height / 2 }, barrier.width / 2, barrier.height / 2))
      .map((barrier) => ({ id: barrier.id, position: { x: barrier.x + barrier.width / 2, y: barrier.y + barrier.height / 2 }, label: 'Shutter' })) ?? [],
  ];
}

function pointSegmentDistance(point: LaunchPoint, a: LaunchPoint, b: LaunchPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function segmentRectangleDistance(a: LaunchPoint, b: LaunchPoint, rect: { x: number; y: number; width: number; height: number }): number {
  const right = rect.x + rect.width, bottom = rect.y + rect.height;
  const pointDistance = (p: LaunchPoint) => Math.hypot(Math.max(rect.x - p.x, 0, p.x - right), Math.max(rect.y - p.y, 0, p.y - bottom));
  let enter = 0, leave = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, rect.x, right], [a.y, b.y - a.y, rect.y, bottom]]) {
    if (delta === 0) { if (start < min || start > max) { enter = 2; break; } }
    else { const t1 = (min - start) / delta, t2 = (max - start) / delta;
      enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2)); }
  }
  if (enter <= leave) return 0;
  return Math.min(pointDistance(a), pointDistance(b), ...[
    { x: rect.x, y: rect.y }, { x: right, y: rect.y }, { x: rect.x, y: bottom }, { x: right, y: bottom },
  ].map((point) => pointSegmentDistance(point, a, b)));
}

function placementClear(run: EndlessRun, use: Extract<ToolUse, { tool: 'bounce' | 'stitch' }>): boolean {
  const stitch = use.tool === 'stitch';
  const angle = (use.tool === 'bounce' ? use.angle : 0) * Math.PI / 180;
  const half = stitch ? 0 : (BOUNCE_PATCH_LENGTH - BOUNCE_PATCH_THICKNESS) / 2;
  const physicalRadius = stitch ? STITCH_POCKET_WIDTH / 2 : BOUNCE_PATCH_THICKNESS / 2;
  const clearance = stitch ? MAX_PULL + BUTTON_RADIUS : physicalRadius + BUTTON_RADIUS;
  const a = { x: use.position.x - Math.cos(angle) * half, y: use.position.y - Math.sin(angle) * half };
  const b = { x: use.position.x + Math.cos(angle) * half, y: use.position.y + Math.sin(angle) * half };
  if (!visible(run, use.position, Math.abs(Math.cos(angle) * half) + physicalRadius,
    stitch ? 35 : Math.abs(Math.sin(angle) * half) + physicalRadius)) return false;
  for (const pocket of effectivePockets(run.room, run.state)) {
    const position = pocketPosition(pocket, run.state.tick, run.state);
    if (pocket.id === run.state.pocketId || (use.tool === 'bounce' && pocket.id === run.state.stitchedPocket?.pocket.id)) {
      const center = pocket.orbit ? pocket.center : position;
      if (pointSegmentDistance(center, a, b) <= MAX_PULL + BUTTON_RADIUS + physicalRadius + (pocket.orbit?.radius ?? 0)) return false;
    }
    if (stitch && pocket.orbit
      && pointSegmentDistance(pocket.center, a, b) <= pocket.orbit.radius + pocket.width / 2 + physicalRadius + BUTTON_RADIUS) return false;
    if (stitch && pocket.motion && segmentRectangleDistance(a, b, {
      x: pocket.center.x - pocket.motion.amplitude - pocket.width / 2, y: pocket.center.y - 4,
      width: pocket.width + pocket.motion.amplitude * 2, height: 39,
    }) <= physicalRadius + BUTTON_RADIUS) return false;
    if (segmentRectangleDistance(a, b, { x: position.x - pocket.width / 2, y: position.y - 4, width: pocket.width, height: 39 }) <= physicalRadius + BUTTON_RADIUS) return false;
  }
  for (const obstacle of run.room.bumpers) if (pointSegmentDistance(obstacle.center, a, b) <= obstacle.radius + clearance) return false;
  for (const obstacle of run.room.hazards) {
    if (stitch && obstacle.motion) {
      const amplitude = obstacle.motion.amplitude;
      const vertical = obstacle.motion.axis === 'y';
      if (segmentRectangleDistance(a, b, { x: obstacle.center.x - (vertical ? 0 : amplitude),
        y: obstacle.center.y - (vertical ? amplitude : 0), width: vertical ? 0 : amplitude * 2,
        height: vertical ? amplitude * 2 : 0 }) <= obstacle.radius + clearance) return false;
    } else if (pointSegmentDistance(hazardPosition(obstacle, run.state.tick, run.state), a, b) <= obstacle.radius + clearance) return false;
  }
  // Reserve shutters even while open; already torn cloth and opened doors stay clear too.
  for (const barrier of run.room.barriers ?? []) {
    if (barrier.kind === 'tearable' && run.state.brokenBarrierIds?.includes(barrier.id)) continue;
    if (barrier.kind === 'door' && run.room.switches?.some((sensor) => sensor.doorIds.includes(barrier.id) && run.state.activatedSwitchIds?.includes(sensor.id))) continue;
    if (segmentRectangleDistance(a, b, barrier) <= clearance) return false;
  }
  const bounce = run.state.toolEffects?.bounce;
  if (stitch && bounce && !bounce.spent) {
    const radians = bounce.angle * Math.PI / 180, patchHalf = (BOUNCE_PATCH_LENGTH - BOUNCE_PATCH_THICKNESS) / 2;
    if (pointSegmentDistance(use.position, { x: bounce.position.x - Math.cos(radians) * patchHalf, y: bounce.position.y - Math.sin(radians) * patchHalf },
      { x: bounce.position.x + Math.cos(radians) * patchHalf, y: bounce.position.y + Math.sin(radians) * patchHalf }) <= clearance + BOUNCE_PATCH_THICKNESS / 2) return false;
  }
  return true;
}

/** Pure world validation; inventory and point authorization are checked separately. */
export function validateToolUse(run: EndlessRun, candidate: ToolUse): boolean {
  const use = parseToolUse(candidate);
  if (!use) return false;
  if (use.tool === 'revive') return run.state.phase === 'failed' && !run.reviveUsed && !!run.lastCatchSnapshot;
  if (use.tool === 'teleport') return eligibleTeleportPockets(run).some((pocket) => pocket.id === use.pocketId);
  if (run.state.phase !== 'held') return false;
  const source = effectivePockets(run.room, run.state).find((pocket) => pocket.id === run.state.pocketId);
  if (!source || isPocketExpired(run.state, source)) return false;
  if (use.tool === 'preview') return !run.previewActive;
  if ((run.generationVersion ?? 1) < 5) return false;
  const effects = run.state.toolEffects;
  switch (use.tool) {
    case 'bounce': return !effects?.bounce && placementClear(run, use);
    case 'stitch': return !run.state.stitchedPocket && !run.state.stitchUsedSinceAuthored && placementClear(run, use);
    case 'pin': return !effects?.pin && eligiblePinTargets(run).some((target) => target.id === use.targetId);
    case 'velcro': return !effects?.velcro && eligibleVelcroTargets(run).some((target) => target.id === use.targetId);
    case 'sail': return !effects?.sail;
    case 'needle': return !effects?.needle;
  }
}

export function getToolPlacement(run: EndlessRun, tool: 'bounce' | 'stitch', position: LaunchPoint, angle = 0): ToolUse | null {
  const point = { x: Math.round(position.x), y: Math.round(position.y) };
  const use: ToolUse = tool === 'bounce' ? { tool, position: point, angle: ((Math.round(angle) % 180) + 180) % 180 } : { tool, position: point };
  return validateToolUse(run, use) ? use : null;
}

export function applyEndlessTool(run: EndlessRun, use: ToolUse, paid = false): boolean {
  if (!validateToolUse(run, use)) return false;
  if (use.tool === 'preview') return activatePreview(run, paid);
  if (use.tool === 'teleport') return teleportEndless(run, use.pocketId, paid);
  if (use.tool === 'revive') return reviveEndless(run, paid);
  if (!paid && !spendFreeTool(run, use.tool)) return false;
  run.state.toolEffects ??= {};
  switch (use.tool) {
    case 'bounce': run.state.toolEffects.bounce = { position: { ...use.position }, angle: use.angle, spent: false }; break;
    case 'pin': run.state.toolEffects.pin = { targetId: use.targetId, startedTick: run.state.tick }; break;
    case 'velcro': run.state.toolEffects.velcro = { targetId: use.targetId }; break;
    case 'sail': run.state.toolEffects.sail = true; break;
    case 'needle': run.state.toolEffects.needle = {}; break;
    case 'stitch':
      run.state.stitchedPocket = { pocket: { id: `tool-stitch-${run.state.tick}-${run.state.launches}`, center: { ...use.position },
        width: STITCH_POCKET_WIDTH, kind: 'checkpoint' }, spent: false, originPocketId: run.state.pocketId };
      run.state.stitchUsedSinceAuthored = true;
      break;
  }
  run.state.event = { type: 'tool', tick: run.state.tick,
    id: 'targetId' in use ? use.targetId : use.tool === 'stitch' ? run.state.stitchedPocket!.pocket.id : run.state.pocketId,
    kind: use.tool };
  return true;
}

export function creativeToolIsArmed(run: EndlessRun, kind: ToolKind): boolean {
  return isCreativeTool(kind) && (kind === 'stitch' ? !!run.state.stitchedPocket : !!run.state.toolEffects?.[kind]);
}
