import { CREATIVE_TOOLS, isToolKind } from '../../commerce/contracts';
import type { EndlessRun, EndlessWorldSnapshot, OwnedSection } from './endless';
import { INTRODUCED_MECHANICS, worldStageForScore } from './progression';
import { INTERACTIVE_MECHANICS } from './interactiveProgression';
import { FREE_TOOL_CAPACITY } from './toolInventory';

/** Copy arrays and every mutable point/state record; immutable definitions remain plain data. */
function copyData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyData) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyData(item)])) as T;
  }
  return value;
}

export function captureEndlessWorld(run: EndlessRun): EndlessWorldSnapshot {
  const { inventory: _inventory, freeToolQueue: _freeToolQueue, reviveUsed: _reviveUsed, previewActive: _previewActive,
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
  return JSON.stringify({ version: run.generationVersion ?? 1, run }, (_key, value: unknown) => {
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
function idList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 64 && value.every((id) => typeof id === 'string');
}

const WORLD_MECHANICS = INTRODUCED_MECHANICS;
const WORLD_SECTION_FIELDS = ['worldStage', 'mechanics', 'introduction', 'windZoneIds'];
const INTERACTIVE_SECTION_FIELDS = ['barrierIds', 'switchIds'];
type SectionVersion = 2 | 3 | 4 | 5 | 6;

function validWorldSection(section: Record<string, unknown>, worldStage: number, version: 3 | 4 | 5 | 6): boolean {
  const introductions: readonly string[] = version >= 4 ? INTERACTIVE_MECHANICS : WORLD_MECHANICS;
  const allowed = [...introductions, 'gate', 'fray'];
  if (!nonnegativeInteger(section.worldStage) || section.worldStage > worldStage
    || !idList(section.windZoneIds) || !Array.isArray(section.mechanics) || section.mechanics.length > 2
    || new Set(section.mechanics).size !== section.mechanics.length
    || !section.mechanics.every((mechanic) => allowed.includes(mechanic))) return false;
  if (version >= 4 && (section.windZoneIds.length !== 0 || !idList(section.barrierIds) || !idList(section.switchIds))) return false;
  if (section.introduction !== undefined && (!introductions.includes(String(section.introduction))
    || section.mechanics.length !== 1 || section.mechanics[0] !== section.introduction)) return false;
  const mechanics = section.mechanics;
  return introductions.every((mechanic, index) => !mechanics.includes(mechanic)
    || (section.worldStage as number) >= index + 1);
}

function validSections(world: Record<string, unknown>, version: SectionVersion): boolean {
  const progress = world.sectionProgress;
  if (!record(progress) || !nonnegativeInteger(progress.nextIndex)
    || !['fork', 'cushion', 'gate', 'fray'].includes(String(progress.lastFamily))
    || !Array.isArray(progress.sections) || !progress.sections.length || progress.sections.length > 8
    || !record(world.room) || !Array.isArray(world.room.pockets)) return false;
  const worldStage = worldStageForScore(world.pocketsCaught as number);
  if (version >= 3 ? !Array.isArray(progress.introductions) || progress.introductions.length !== 4
    || !progress.introductions.every((count, index) => nonnegativeInteger(count) && count <= 3 && (index < worldStage || count === 0))
    : progress.introductions !== undefined) return false;
  const pockets = world.room.pockets as Record<string, unknown>[];
  const nextIndex = progress.nextIndex;
  const pocketById = new Map(pockets.map((pocket) => [pocket.id, pocket]));
  if (!progress.sections.every((section) => record(section)
    && typeof section.id === 'string' && nonnegativeInteger(section.index) && section.index < nextIndex
    && typeof section.patternId === 'string' && ['fork', 'cushion', 'gate', 'fray'].includes(String(section.family))
    && nonnegativeInteger(section.startRank) && nonnegativeInteger(section.endRank)
    && section.startRank >= 3 && section.endRank > section.startRank && section.endRank - section.startRank <= 2
    && typeof section.cue === 'string' && typeof section.entryPocketId === 'string'
    && typeof section.exitPocketId === 'string' && idList(section.pocketIds)
    && idList(section.bumperIds) && idList(section.hazardIds) && idList(section.pickupIds)
    && Array.isArray(section.connections) && section.connections.length <= 32
    && section.connections.every((edge) => record(edge) && typeof edge.from === 'string' && typeof edge.to === 'string')
    && (version >= 3 ? validWorldSection(section, worldStage, version as 3 | 4 | 5 | 6) : WORLD_SECTION_FIELDS.every((key) => section[key] === undefined))
    && (version >= 4 || INTERACTIVE_SECTION_FIELDS.every((key) => section[key] === undefined)))) return false;

  const sections = progress.sections as unknown as OwnedSection[];
  const claimed = { pocketIds: new Set<string>(), bumperIds: new Set<string>(), hazardIds: new Set<string>(), pickupIds: new Set<string>(),
    windZoneIds: new Set<string>(), barrierIds: new Set<string>(), switchIds: new Set<string>() };
  const objectIds = {
    pocketIds: new Set(pockets.map((pocket) => String(pocket.id))),
    bumperIds: new Set((world.room.bumpers as Record<string, unknown>[]).map((bumper) => String(bumper.id))),
    hazardIds: new Set((world.room.hazards as Record<string, unknown>[]).map((hazard) => String(hazard.id))),
    pickupIds: new Set(((world.room.pickups ?? []) as Record<string, unknown>[]).map((pickup) => String(pickup.id))),
    windZoneIds: new Set(((world.room.windZones ?? []) as Record<string, unknown>[]).map((zone) => String(zone.id))),
    barrierIds: new Set(((world.room.barriers ?? []) as Record<string, unknown>[]).map((barrier) => String(barrier.id))),
    switchIds: new Set(((world.room.switches ?? []) as Record<string, unknown>[]).map((button) => String(button.id))),
  };
  const collected = record(world.state) && idList(world.state.pickupIds) ? world.state.pickupIds : [];
  if (new Set(collected).size !== collected.length) return false;
  for (const [index, section] of sections.entries()) {
    const previous = sections[index - 1];
    if (section.id !== `section-${section.index}` || (previous && (previous.index >= section.index
      || previous.endRank >= section.startRank))) return false;
    if (version >= 3 && previous && previous.worldStage! > section.worldStage!) return false;
    if (section.index === 0 && (section.startRank !== 3 || section.entryPocketId !== 'endless-2')) return false;
    if (previous?.index === section.index - 1
      && (section.startRank !== previous.endRank + 1 || section.entryPocketId !== previous.exitPocketId)) return false;
    for (const key of ['pocketIds', 'bumperIds', 'hazardIds', 'pickupIds', 'windZoneIds', 'barrierIds', 'switchIds'] as const) {
      for (const id of section[key] ?? []) {
        if (!id.startsWith(`${section.id}-`) || claimed[key].has(id)
          || (!objectIds[key].has(id) && !(key === 'pickupIds' && collected.includes(id)))) return false;
        claimed[key].add(id);
      }
    }
    for (const id of section.pocketIds) {
      const pocket = pocketById.get(id)!;
      if (pocket.sectionId !== section.id || !finite(pocket.ascentRank)
        || pocket.ascentRank < section.startRank || pocket.ascentRank > section.endRank) return false;
    }
    if (!section.pocketIds.includes(section.exitPocketId)
      || pocketById.get(section.exitPocketId)!.ascentRank !== section.endRank) return false;
    const entry = pocketById.get(section.entryPocketId);
    if (entry && entry.ascentRank !== section.startRank - 1) return false;
    const edges = new Set<string>();
    for (const edge of section.connections) {
      const edgeId = `${edge.from}:${edge.to}`;
      if (edges.has(edgeId) || !section.pocketIds.includes(edge.to)
        || (edge.from !== section.entryPocketId && !section.pocketIds.includes(edge.from))) return false;
      edges.add(edgeId);
      const fromRank = edge.from === section.entryPocketId ? section.startRank - 1 : pocketById.get(edge.from)!.ascentRank;
      if (!finite(fromRank) || pocketById.get(edge.to)!.ascentRank !== fromRank + 1) return false;
    }
    if (section.pocketIds.some((id) => !section.connections.some((edge) => edge.to === id)
      || (id !== section.exitPocketId && !section.connections.some((edge) => edge.from === id)))) return false;
    if (version === 3) {
      const mechanics = section.mechanics!;
      const ownedPockets = section.pocketIds.map((id) => pocketById.get(id)!);
      const ownedBumpers = (world.room.bumpers as Record<string, unknown>[]).filter((bumper) => section.bumperIds.includes(String(bumper.id)));
      const ownedHazards = (world.room.hazards as Record<string, unknown>[]).filter((hazard) => section.hazardIds.includes(String(hazard.id)));
      // A caught swaying pocket permanently freezes, while its section keeps its original metadata.
      if ((ownedPockets.some((pocket) => pocket.motion !== undefined) && !mechanics.includes('sway'))
        || ownedPockets.some((pocket) => pocket.frayTicks !== undefined) !== mechanics.includes('fray')
        || ownedBumpers.some((bumper) => bumper.springSpeed !== undefined) !== mechanics.includes('spring')
        || ownedHazards.some((hazard) => hazard.visual === 'scissors') !== mechanics.includes('scissors')
        || ownedHazards.some((hazard) => hazard.motion !== undefined && hazard.visual !== 'scissors') !== mechanics.includes('gate')
        || (section.windZoneIds!.length > 0) !== mechanics.includes('wind')) return false;
      if (mechanics.length > 1 && WORLD_MECHANICS.some((mechanic, index) =>
        mechanics.includes(mechanic) && (progress.introductions as number[])[index] < 3)) return false;
    }
    if (version >= 4) {
      const mechanics = section.mechanics!;
      const ownedPockets = section.pocketIds.map((id) => pocketById.get(id)!);
      const ownedBarriers = (world.room.barriers as Record<string, unknown>[]).filter((barrier) => section.barrierIds!.includes(String(barrier.id)));
      const ownedSwitches = (world.room.switches as Record<string, unknown>[]).filter((button) => section.switchIds!.includes(String(button.id)));
      const ownedHazards = (world.room.hazards as Record<string, unknown>[]).filter((hazard) => section.hazardIds.includes(String(hazard.id)));
      if (ownedPockets.some((pocket) => pocket.orbit !== undefined) !== mechanics.includes('hoop')
        || ownedPockets.some((pocket) => pocket.frayTicks !== undefined) !== mechanics.includes('fray')
        || ownedHazards.some((hazard) => hazard.motion !== undefined) !== mechanics.includes('gate')
        || ownedBarriers.some((barrier) => barrier.kind === 'tearable') !== mechanics.includes('tear')
        || ownedBarriers.some((barrier) => barrier.kind === 'shutter') !== mechanics.includes('shutter')
        || (ownedSwitches.length > 0) !== mechanics.includes('switch')) return false;
      const doors = new Set(ownedBarriers.filter((barrier) => barrier.kind === 'door').map((barrier) => String(barrier.id)));
      const linkedDoors = new Set<string>();
      for (const button of ownedSwitches) {
        if (button.pocketId !== undefined && !section.pocketIds.includes(String(button.pocketId))) return false;
        for (const id of button.doorIds as string[]) {
          if (!doors.has(id)) return false;
          linkedDoors.add(id);
        }
      }
      if ([...doors].some((id) => !linkedDoors.has(id))) return false;
      if (mechanics.length > 1 && INTERACTIVE_MECHANICS.some((mechanic, index) =>
        mechanics.includes(mechanic) && (progress.introductions as number[])[index] < 3)) return false;
    }
  }
  const opening = pockets.filter((pocket) => pocket.sectionId === 'opening');
  if (opening.length !== 0 && (opening.length !== 3 || opening.some((pocket) =>
    !nonnegativeInteger(pocket.ascentRank) || pocket.ascentRank > 2 || pocket.id !== `endless-${pocket.ascentRank}`))) return false;
  if (pockets.some((pocket) => pocket.sectionId !== 'opening' && !claimed.pocketIds.has(String(pocket.id)))) return false;
  if (opening.length) {
    claimed.pickupIds.add('opening-preview');
    if (!objectIds.pickupIds.has('opening-preview') && !collected.includes('opening-preview')) return false;
  }
  for (const key of ['bumperIds', 'hazardIds', 'pickupIds', 'windZoneIds', 'barrierIds', 'switchIds'] as const) {
    if ([...objectIds[key]].some((id) => !claimed[key].has(id))) return false;
  }
  if (collected.some((id) => !claimed.pickupIds.has(id) || objectIds.pickupIds.has(id))) return false;
  if (version >= 3 && (version >= 4 ? INTERACTIVE_MECHANICS : WORLD_MECHANICS).some((mechanic, index) =>
    sections.filter((section) => section.introduction === mechanic).length > (progress.introductions as number[])[index])) return false;
  const last = sections[sections.length - 1];
  return progress.nextIndex === last.index + 1 && progress.lastFamily === last.family
    && world.nextPocketIndex === last.endRank + 1 && world.lastPatternId === last.patternId
    && world.lastGeneratedY === (pocketById.get(last.exitPocketId)!.center as Record<string, unknown>).y;
}

function validWindZones(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 64 || !value.every((zone) => record(zone)
    && typeof zone.id === 'string' && finite(zone.x) && finite(zone.y)
    && finite(zone.width) && zone.width > 0 && finite(zone.height) && zone.height > 0
    && finite(zone.x + zone.width) && finite(zone.y + zone.height)
    && finite(zone.accelerationX) && Math.abs(zone.accelerationX) <= 120)) return false;
  if (new Set(value.map((zone) => zone.id)).size !== value.length) return false;
  return value.every((zone, index) => value.slice(index + 1).every((other) =>
    zone.x >= other.x + other.width || zone.x + zone.width <= other.x
    || zone.y >= other.y + other.height || zone.y + zone.height <= other.y));
}

function uniqueIds(value: unknown): value is string[] {
  return idList(value) && new Set(value).size === value.length;
}

/** Validate saved effects, not their original placement: the camera and targets may have moved. */
function validToolState(room: Record<string, unknown>, state: Record<string, unknown>, version: number): boolean {
  const fields = ['toolEffects', 'toolPhaseOffsets', 'stitchedPocket', 'stitchUsedSinceAuthored'];
  if (version < 5) return fields.every((key) => state[key] === undefined);
  if (state.stitchUsedSinceAuthored !== undefined && typeof state.stitchUsedSinceAuthored !== 'boolean') return false;
  const pockets = room.pockets as Record<string, unknown>[];
  const hazards = room.hazards as Record<string, unknown>[];
  const barriers = (room.barriers ?? []) as Record<string, unknown>[];
  const moving = (id: string) => pockets.some((pocket) => pocket.id === id && (pocket.motion || pocket.orbit))
    || hazards.some((hazard) => hazard.id === id && hazard.motion)
    || barriers.some((barrier) => barrier.id === id && barrier.kind === 'shutter');
  const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
  const integerPoint = (value: unknown) => record(value) && exactKeys(value, ['x', 'y'])
    && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
  const offsets = state.toolPhaseOffsets;
  if (offsets !== undefined && (!record(offsets) || Object.keys(offsets).length > 128
    || !Object.entries(offsets).every(([id, ticks]) => moving(id) && nonnegativeInteger(ticks)
      && finite(state.tick) && ticks <= state.tick))) return false;
  let stitchedId: string | undefined;
  if (state.stitchedPocket !== undefined) {
    const stitch = state.stitchedPocket;
    if (!record(stitch) || !exactKeys(stitch, ['pocket', 'spent', 'originPocketId'])
      || typeof stitch.spent !== 'boolean' || typeof stitch.originPocketId !== 'string'
      || !pockets.some((pocket) => pocket.id === stitch.originPocketId) || !record(stitch.pocket)) return false;
    const pocket = stitch.pocket;
    if (!exactKeys(pocket, ['id', 'center', 'width', 'kind']) || typeof pocket.id !== 'string'
      || !pocket.id.startsWith('tool-stitch-') || pocket.id.length > 160
      || pockets.some((item) => item.id === pocket.id) || !integerPoint(pocket.center)
      || pocket.width !== 80 || pocket.kind !== 'checkpoint'
      || (stitch.spent && state.pocketId !== pocket.id)
      || (stitch.spent && state.phase === 'held')) return false;
    stitchedId = pocket.id;
  }
  const effects = state.toolEffects;
  if (effects === undefined) return true;
  if (!record(effects) || !exactKeys(effects, ['bounce', 'pin', 'velcro', 'sail', 'needle'])) return false;
  if (effects.bounce !== undefined && (!record(effects.bounce)
    || !exactKeys(effects.bounce, ['position', 'angle', 'spent']) || !integerPoint(effects.bounce.position)
    || !nonnegativeInteger(effects.bounce.angle) || effects.bounce.angle >= 180
    || typeof effects.bounce.spent !== 'boolean')) return false;
  if (effects.pin !== undefined && (!record(effects.pin) || !exactKeys(effects.pin, ['targetId', 'startedTick'])
    || typeof effects.pin.targetId !== 'string' || !moving(effects.pin.targetId)
    || !nonnegativeInteger(effects.pin.startedTick) || !finite(state.tick) || effects.pin.startedTick > state.tick
    || (record(offsets) && Number(offsets[effects.pin.targetId] ?? 0) > effects.pin.startedTick))) return false;
  if (effects.velcro !== undefined && (!record(effects.velcro) || !exactKeys(effects.velcro, ['targetId'])
    || typeof effects.velcro.targetId !== 'string'
    || (!pockets.some((pocket) => pocket.id === (effects.velcro as Record<string, unknown>).targetId)
      && effects.velcro.targetId !== stitchedId))) return false;
  if (effects.sail !== undefined && effects.sail !== true) return false;
  if (effects.needle !== undefined && (!record(effects.needle) || !exactKeys(effects.needle, ['piercedId'])
    || (effects.needle.piercedId !== undefined && (typeof effects.needle.piercedId !== 'string'
      || (!hazards.some((hazard) => hazard.id === (effects.needle as Record<string, unknown>).piercedId && hazard.visual !== 'scissors')
        && !barriers.some((barrier) => barrier.id === (effects.needle as Record<string, unknown>).piercedId && barrier.kind === 'thorns')))))) return false;
  return true;
}

function validInteractiveState(room: Record<string, unknown>, state: Record<string, unknown>): boolean {
  if (!Array.isArray(room.barriers) || room.barriers.length > 64 || !room.barriers.every((barrier) => record(barrier)
    && typeof barrier.id === 'string' && finite(barrier.x) && finite(barrier.y)
    && finite(barrier.width) && barrier.width > 0 && finite(barrier.height) && barrier.height > 0
    && finite(barrier.x + barrier.width) && finite(barrier.y + barrier.height)
    && ['solid', 'tearable', 'door', 'thorns', 'shutter'].includes(String(barrier.kind))
    && (barrier.phaseTicks === undefined || (nonnegativeInteger(barrier.phaseTicks) && barrier.phaseTicks < 480)))) return false;
  if (!Array.isArray(room.switches) || room.switches.length > 64 || !room.switches.every((button) => record(button)
    && typeof button.id === 'string' && point(button.center) && finite(button.radius) && button.radius > 0 && button.radius <= 80
    && uniqueIds(button.doorIds) && button.doorIds.length > 0
    && (button.pocketId === undefined || typeof button.pocketId === 'string'))) return false;
  const ids = ['pockets', 'bumpers', 'hazards', 'pickups', 'barriers', 'switches'].flatMap((key) =>
    ((room[key] ?? []) as Record<string, unknown>[]).map((item) => item.id));
  if (new Set(ids).size !== ids.length) return false;
  if (!uniqueIds(state.brokenBarrierIds) || !uniqueIds(state.activatedSwitchIds)) return false;
  const barriers = room.barriers as Record<string, unknown>[];
  const switches = room.switches as Record<string, unknown>[];
  return state.brokenBarrierIds.every((id) => barriers.some((barrier) => barrier.id === id && barrier.kind === 'tearable'))
    && state.activatedSwitchIds.every((id) => switches.some((button) => button.id === id));
}

function validWorld(value: unknown, version: 1 | 2 | 3 | 4 | 5 | 6): boolean {
  if (!record(value) || !record(value.room) || !record(value.state)) return false;
  const { room, state } = value;
  if (version >= 2 ? value.generationVersion !== version : value.generationVersion !== undefined && value.generationVersion !== 1) return false;
  if (!record(room.bounds) || room.bounds.width !== 360 || room.bounds.height !== 600
    || !finite(room.gravity) || !finite(value.cameraY)
    || !nonnegativeInteger(value.seed) || !nonnegativeInteger(value.highestPocket)
    || !nonnegativeInteger(value.pocketsCaught) || !finite(value.height)
    || !nonnegativeInteger(value.nextPocketIndex) || !finite(value.lastGeneratedY)
    || typeof value.nextPocketId !== 'string' || typeof value.lastPatternId !== 'string'
    || !record(value.lastExitX) || !finite(value.lastExitX.min) || !finite(value.lastExitX.max)
    || value.nextPocketIndex <= value.highestPocket || value.nextPocketIndex > value.highestPocket + (version >= 2 ? 9 : 6)
    || value.pocketsCaught > value.highestPocket || value.lastExitX.min > value.lastExitX.max
    || !['opening', 'recovery', 'arc', 'bank', 'reverse', 'timing'].includes(String(value.lastFamily))
    || !Array.isArray(value.challenges) || value.challenges.length > 32
    || !value.challenges.every((challenge) => record(challenge) && nonnegativeInteger(challenge.index)
      && typeof challenge.pocketId === 'string' && typeof challenge.patternId === 'string'
      && idList(challenge.bumperIds) && idList(challenge.hazardIds) && idList(challenge.pickupIds))) return false;
  if (room.bounds.top !== Number.NEGATIVE_INFINITY && !finite(room.bounds.top)) return false;
  if (!finite(room.bounds.bottom)) return false;
  if (room.sideWallRestitution !== undefined && (!finite(room.sideWallRestitution)
    || room.sideWallRestitution < 0 || room.sideWallRestitution > 1)) return false;
  if (!Array.isArray(room.pockets) || !room.pockets.length || room.pockets.length > 32
    || !room.pockets.every((pocket) => record(pocket) && typeof pocket.id === 'string'
      && point(pocket.center) && finite(pocket.width) && pocket.width > 0
      && ['start', 'checkpoint', 'goal'].includes(String(pocket.kind))
      && (version < 2 || (typeof pocket.sectionId === 'string' && nonnegativeInteger(pocket.ascentRank)))
      && (pocket.route === undefined || ['safe', 'reward', 'recovery'].includes(String(pocket.route)))
      && (pocket.frayTicks === undefined || (nonnegativeInteger(pocket.frayTicks) && pocket.frayTicks > 0))
      && (pocket.motion === undefined || (version < 4 && record(pocket.motion) && finite(pocket.motion.amplitude)
        && finite(pocket.motion.periodTicks) && pocket.motion.periodTicks > 0 && finite(pocket.motion.phaseTicks)))
      && (pocket.orbit === undefined || (version >= 4 && record(pocket.orbit)
        && finite(pocket.orbit.radius) && pocket.orbit.radius > 0 && pocket.orbit.radius <= 80
        && finite(pocket.orbit.periodTicks) && pocket.orbit.periodTicks >= 120 && finite(pocket.orbit.phaseTicks)
        && (pocket.orbit.direction === undefined || pocket.orbit.direction === 1 || pocket.orbit.direction === -1))))) return false;
  for (const key of ['bumpers', 'hazards', 'pickups']) {
    const objects = room[key];
    if (key === 'pickups' && objects === undefined) continue;
    if (!Array.isArray(objects) || objects.length > 64 || !objects.every((object) => record(object)
      && typeof object.id === 'string' && point(object.center) && finite(object.radius) && object.radius > 0
      && (key !== 'bumpers' || (finite(object.restitution)
        && (object.springSpeed === undefined || (version === 3 && finite(object.springSpeed)
          && object.springSpeed > 0 && object.springSpeed <= 850))))
      && (key !== 'hazards' || object.visual === undefined || (version === 3 && object.visual === 'scissors'))
      && (key !== 'hazards' || object.motion === undefined || (record(object.motion)
        && finite(object.motion.amplitude) && finite(object.motion.phaseTicks)
        && finite(object.motion.periodTicks) && object.motion.periodTicks > 0
        && (object.motion.axis === undefined || ['x', 'y'].includes(String(object.motion.axis)))))
      && (key !== 'pickups' || (version >= 5 ? isToolKind(object.kind) : ['preview', 'teleport', 'revive'].includes(String(object.kind)))))) return false;
    if (version >= 2 && new Set(objects.map((object) => object.id)).size !== objects.length) return false;
  }
  if (version === 3 ? !validWindZones(room.windZones)
    : version >= 4 ? room.windZones !== undefined && (!Array.isArray(room.windZones) || room.windZones.length !== 0)
      : room.windZones !== undefined) return false;
  if (version >= 4 ? !validInteractiveState(room, state)
    : room.barriers !== undefined || room.switches !== undefined
      || state.brokenBarrierIds !== undefined || state.activatedSwitchIds !== undefined) return false;
  if (version === 1 && record(value.sectionProgress) && (value.sectionProgress.introductions !== undefined
    || (Array.isArray(value.sectionProgress.sections) && value.sectionProgress.sections.some((section) =>
      record(section) && [...WORLD_SECTION_FIELDS, ...INTERACTIVE_SECTION_FIELDS].some((key) => section[key] !== undefined))))) return false;
  const checkedPockets = room.pockets as Record<string, unknown>[];
  if (new Set(room.pockets.map((pocket) => pocket.id)).size !== room.pockets.length) return false;
  if (state.pocketExpiryTicks !== undefined && (!record(state.pocketExpiryTicks)
    || Object.keys(state.pocketExpiryTicks).length > 32
    || !Object.entries(state.pocketExpiryTicks).every(([id, expiry]) => nonnegativeInteger(expiry)
      && checkedPockets.some((pocket) => pocket.id === id && finite(pocket.frayTicks))))) return false;
  if (!validToolState(room, state, version)) return false;
  if (state.frayedFall !== undefined && typeof state.frayedFall !== 'boolean') return false;
  if (version >= 2 && !validSections(value, version as SectionVersion)) return false;
  if (version >= 2) {
    const current = checkedPockets.find((pocket) => pocket.id === state.pocketId);
    if (current?.frayTicks !== undefined) {
      const expiry = record(state.pocketExpiryTicks) ? state.pocketExpiryTicks[String(state.pocketId)] : undefined;
      if (!nonnegativeInteger(expiry) || (finite(state.tick) && finite(current.frayTicks)
        && (expiry > state.tick + current.frayTicks || (state.phase === 'held' && expiry <= state.tick)))) return false;
    }
  }
  return nonnegativeInteger(state.tick) && ['held', 'flying', 'failed', 'complete'].includes(String(state.phase))
    && point(state.position) && point(state.previousPosition) && point(state.velocity)
    && typeof state.pocketId === 'string' && (room.pockets.some((pocket) => pocket.id === state.pocketId)
      || (record(state.stitchedPocket) && record(state.stitchedPocket.pocket) && state.stitchedPocket.pocket.id === state.pocketId))
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
    if (!record(payload) || (payload.version !== 1 && payload.version !== 2 && payload.version !== 3
      && payload.version !== 4 && payload.version !== 5 && payload.version !== 6)
      || !validWorld(payload.run, payload.version) || !record(payload.run)) return null;
    const run = payload.run;
    const inventory = run.inventory;
    if (!record(inventory) || !['preview', 'teleport', 'revive'].every((kind) => nonnegativeInteger(inventory[kind]))
      || typeof run.reviveUsed !== 'boolean' || typeof run.previewActive !== 'boolean'
      || !idList(run.collectedPickupIds) || !validWorld(run.lastCatchSnapshot, payload.version)) return null;
    for (const kind of CREATIVE_TOOLS) {
      if (payload.version < 5 && inventory[kind] === undefined) inventory[kind] = 0;
      if (!nonnegativeInteger(inventory[kind]) || (payload.version < 5 && inventory[kind] !== 0)) return null;
    }
    if (Object.keys(inventory).some((kind) => !isToolKind(kind))) return null;
    if (payload.version >= 6) {
      const queue = run.freeToolQueue;
      if (!Array.isArray(queue) || queue.length > FREE_TOOL_CAPACITY || !queue.every(isToolKind)
        || Object.entries(inventory).some(([kind, count]) => queue.filter((entry) => entry === kind).length !== count)) return null;
    } else if (run.freeToolQueue !== undefined) return null;
    const checkpoint = run.lastCatchSnapshot;
    if (!record(checkpoint) || ['inventory', 'freeToolQueue', 'reviveUsed', 'previewActive', 'collectedPickupIds', 'lastCatchSnapshot']
      .some((key) => key in checkpoint)) return null;
    if (payload.version >= 5 && record(checkpoint.state) && record(checkpoint.state.toolEffects)
      && Object.keys(checkpoint.state.toolEffects).length) return null;
    if (record(run.room) && record(checkpoint.room)
      && run.room.sideWallRestitution !== checkpoint.room.sideWallRestitution) return null;
    if (payload.version >= 2) {
      const collected = run.collectedPickupIds as string[];
      const stateCollected = (run.state as Record<string, unknown>).pickupIds as string[];
      const checkpointCollected = (checkpoint.state as Record<string, unknown>).pickupIds as string[];
      if (new Set(collected).size !== collected.length || collected.length !== stateCollected.length
        || stateCollected.some((id) => !collected.includes(id))
        || checkpointCollected.some((id) => !collected.includes(id))) return null;
    }
    if (payload.version >= 3) {
      const progress = run.sectionProgress as Record<string, unknown>;
      const checkpointProgress = checkpoint.sectionProgress as Record<string, unknown>;
      if (run.seed !== checkpoint.seed || (checkpoint.pocketsCaught as number) > (run.pocketsCaught as number)
        || (checkpoint.highestPocket as number) > (run.highestPocket as number)
        || (checkpointProgress.nextIndex as number) > (progress.nextIndex as number)
        || (checkpointProgress.introductions as number[]).some((count, index) =>
          count > (progress.introductions as number[])[index])) return null;
    }
    if (payload.version >= 4) {
      const currentState = run.state as Record<string, unknown>;
      const checkpointState = checkpoint.state as Record<string, unknown>;
      // Failed flights may change retained barriers and switches after the last catch.
      // Revival restores the exact earlier checkpoint instead of carrying those effects back.
      if (['brokenBarrierIds', 'activatedSwitchIds'].some((key) =>
        (checkpointState[key] as string[]).some((id) => !(currentState[key] as string[]).includes(id)))) return null;
    }
    return run as unknown as EndlessRun;
  } catch {
    return null;
  }
}
