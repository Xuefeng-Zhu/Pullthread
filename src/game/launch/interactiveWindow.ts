import type { EndlessRun, OwnedSection } from './endless';
import { chooseInteractiveSection } from './interactiveSections';
import { INTERACTIVE_MECHANICS } from './interactiveProgression';
import { worldStageForScore } from './progression';
import type { LaunchPoint } from './types';

/** Generate and retain whole sections; score ranks must never own branch geometry. */
export function updateInteractiveWindow(run: EndlessRun): void {
  const progress = run.sectionProgress!;
  let pockets = [...run.room.pockets];
  let bumpers = [...run.room.bumpers];
  let hazards = [...run.room.hazards];
  let pickups = [...run.room.pickups ?? []];
  let barriers = [...run.room.barriers ?? []];
  let switches = [...run.room.switches ?? []];
  if (run.nextPocketIndex === 1) {
    pockets = pockets.map((pocket) => ({ ...pocket, ascentRank: 0, sectionId: 'opening' }));
  }
  while (run.nextPocketIndex < 3) {
    const rank = run.nextPocketIndex;
    const center = { x: rank === 1 ? 240 : 260, y: run.lastGeneratedY - (rank === 1 ? 100 : 135) };
    pockets.push({ id: `endless-${rank}`, kind: 'checkpoint', center, width: 144,
      ascentRank: rank, sectionId: 'opening' });
    if (rank === 2) pickups.push({ id: 'opening-preview', kind: 'preview',
      center: { x: center.x + 20, y: center.y - 45 }, radius: 14 });
    run.lastGeneratedY = center.y;
    run.lastExitX = { min: center.x, max: center.x };
    run.nextPocketIndex += 1;
  }
  while (run.nextPocketIndex <= run.highestPocket + 5) {
    const index = progress.nextIndex;
    const pattern = chooseInteractiveSection(run.seed, index, run.lastExitX, progress.lastFamily,
      run.pocketsCaught, progress.introductions!);
    const id = `section-${index}`;
    const entryPocketId = progress.sections.at(-1)?.exitPocketId ?? 'endless-2';
    const localId = (value: string) => value === 'entry' ? entryPocketId : `${id}-${value}`;
    const translated = (point: LaunchPoint) => ({ x: point.x, y: point.y + run.lastGeneratedY });
    const baseRank = run.nextPocketIndex - 1;
    const ownedPockets = pattern.pockets.map((pocket) => ({ ...pocket, id: localId(pocket.id),
      sectionId: id, ascentRank: baseRank + pocket.ascentRank!, center: translated(pocket.center) }));
    const ownedBumpers = pattern.bumpers.map((bumper) => ({ ...bumper, id: localId(bumper.id), center: translated(bumper.center) }));
    const ownedHazards = pattern.hazards.map((hazard) => ({ ...hazard, id: localId(hazard.id), center: translated(hazard.center) }));
    const ownedBarriers = pattern.barriers.map((value) => ({ ...value, id: localId(value.id), y: value.y + run.lastGeneratedY }));
    const ownedSwitches = pattern.switches.map((value) => ({ ...value, id: localId(value.id), center: translated(value.center),
      doorIds: value.doorIds.map(localId), ...(value.pocketId ? { pocketId: localId(value.pocketId) } : {}),
    }));
    // Leave a full section between gifts while continuing to rotate all three tools.
    const scheduled = (['preview', 'revive', 'teleport'] as const)[Math.floor(index / 2) % 3];
    const kind = scheduled === 'revive' && (run.reviveUsed || run.inventory.revive > 0) ? 'preview' : scheduled;
    const ownedPickups = index % 2 === 0 ? pattern.pickups.map((pickup) => ({
      ...pickup, kind, id: localId(pickup.id), center: translated(pickup.center),
    })) : [];
    const exit = ownedPockets.find((pocket) => pocket.id === localId(pattern.exitPocketId))!;
    const section: OwnedSection = {
      id, index, patternId: pattern.id, family: pattern.family, startRank: baseRank + 1,
      endRank: exit.ascentRank, entryPocketId, exitPocketId: exit.id,
      pocketIds: ownedPockets.map((pocket) => pocket.id), bumperIds: ownedBumpers.map((bumper) => bumper.id),
      hazardIds: ownedHazards.map((hazard) => hazard.id), pickupIds: ownedPickups.map((pickup) => pickup.id),
      connections: pattern.connections.map((edge) => ({ from: localId(edge.from), to: localId(edge.to) })), cue: pattern.cue,
      worldStage: worldStageForScore(run.pocketsCaught), mechanics: pattern.mechanics, windZoneIds: [],
      barrierIds: ownedBarriers.map((value) => value.id), switchIds: ownedSwitches.map((value) => value.id),
      ...(pattern.introduction ? { introduction: pattern.introduction } : {}),
    };
    if (pattern.introduction) {
      const introductions = [...progress.introductions!] as [number, number, number, number];
      introductions[INTERACTIVE_MECHANICS.indexOf(pattern.introduction)] += 1;
      progress.introductions = introductions;
    }
    progress.sections = [...progress.sections, section];
    progress.nextIndex += 1;
    progress.lastFamily = pattern.family;
    pockets.push(...ownedPockets);
    bumpers.push(...ownedBumpers);
    hazards.push(...ownedHazards);
    pickups.push(...ownedPickups);
    barriers.push(...ownedBarriers);
    switches.push(...ownedSwitches);
    run.lastGeneratedY = exit.center.y;
    run.lastExitX = pattern.exitX;
    run.lastPatternId = pattern.id;
    run.nextPocketIndex = exit.ascentRank + 1;
  }
  const reached = progress.sections.filter((section) => section.startRank <= run.highestPocket).at(-1);
  const minimumIndex = (reached?.index ?? 0) - 1;
  const sourceSectionId = pockets.find((pocket) => pocket.id === run.state.pocketId)?.sectionId;
  progress.sections = progress.sections.filter((section) => section.index >= minimumIndex || section.id === sourceSectionId);
  const retainedSections = new Set(progress.sections.map((section) => section.id));
  if (minimumIndex <= 0 || sourceSectionId === 'opening') retainedSections.add('opening');
  const retainedPockets = pockets.filter((pocket) => retainedSections.has(pocket.sectionId!));
  const ids = new Set(retainedPockets.map((pocket) => pocket.id));
  const bumperIds = new Set(progress.sections.flatMap((section) => section.bumperIds));
  const hazardIds = new Set(progress.sections.flatMap((section) => section.hazardIds));
  const pickupIds = new Set(progress.sections.flatMap((section) => section.pickupIds));
  const barrierIds = new Set(progress.sections.flatMap((section) => section.barrierIds ?? []));
  const switchIds = new Set(progress.sections.flatMap((section) => section.switchIds ?? []));
  run.state.brokenBarrierIds = run.state.brokenBarrierIds?.filter((id) => barrierIds.has(id)) ?? [];
  run.state.activatedSwitchIds = run.state.activatedSwitchIds?.filter((id) => switchIds.has(id)) ?? [];
  if (retainedSections.has('opening')) pickupIds.add('opening-preview');
  run.collectedPickupIds = run.collectedPickupIds.filter((id) => pickupIds.has(id));
  run.state.pickupIds = [...run.collectedPickupIds];
  if (run.state.pocketExpiryTicks) run.state.pocketExpiryTicks = Object.fromEntries(
    Object.entries(run.state.pocketExpiryTicks).filter(([id]) => ids.has(id)));
  run.room = { ...run.room, pockets: retainedPockets,
    bumpers: bumpers.filter((bumper) => bumperIds.has(bumper.id)),
    hazards: hazards.filter((hazard) => hazardIds.has(hazard.id)),
    pickups: pickups.filter((pickup) => pickupIds.has(pickup.id) && !run.collectedPickupIds.includes(pickup.id)),
    barriers: barriers.filter((value) => barrierIds.has(value.id)),
    switches: switches.filter((value) => switchIds.has(value.id)), windZones: [],
  };
  const next = progress.sections.flatMap((section) => section.connections)
    .find((edge) => edge.from === run.state.pocketId && ids.has(edge.to));
  run.nextPocketId = next?.to ?? (run.state.pocketId === 'endless-0' ? 'endless-1'
    : run.state.pocketId === 'endless-1' ? 'endless-2'
      : retainedPockets.find((pocket) => pocket.ascentRank! > run.highestPocket)?.id ?? run.state.pocketId);
}
