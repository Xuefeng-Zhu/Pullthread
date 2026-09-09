import { clampEndlessPull } from '../game/launch/launchInput';
import { createEndlessRun, launchEndless, stepEndless, type EndlessRun } from '../game/launch/endless';
import { applyEndlessTool } from '../game/launch/tools';
import { isCreativeTool } from '../commerce/contracts';
import { canonicalToolUse, parseToolUse, type ToolUse } from '../commerce/toolUse';
import { MAX_BATCH_COMMANDS, MAX_BATCH_TICKS, type ReplayBatch, type ReplayCommand } from './contracts';
export interface ReplayCursor { elapsed: number; aiming: boolean }
export function createRankedSimulation(seed: number): EndlessRun { return createEndlessRun(seed, 6); }
function commandToolUse(command: Extract<ReplayCommand, { type: 'tool' }>): ToolUse | null {
  const { type: _type, at: _at, operationId: _operationId, ...use } = command;
  return parseToolUse(use);
}
export function validateBatch(batch: ReplayBatch, elapsed: number): void {
  if (!batch || !Number.isSafeInteger(batch.sequence) || batch.sequence < 0 || batch.from !== elapsed
    || !Number.isSafeInteger(batch.to) || batch.to < elapsed || batch.to - elapsed > MAX_BATCH_TICKS
    || !Array.isArray(batch.commands) || batch.commands.length > MAX_BATCH_COMMANDS) throw new Error('Invalid replay batch.');
  if (batch.to === elapsed && !batch.commands.length) throw new Error('Empty batch.');
  if (batch.commands.filter(command => command?.type === 'tool' && command.operationId).length > 8) throw new Error('Too many paid actions.');
  let previous = elapsed;
  for (const command of batch.commands) {
    if (!command || !Number.isSafeInteger(command.at) || command.at < previous || command.at > batch.to) throw new Error('Invalid command order.');
    previous = command.at;
    if (!['aim', 'cancel', 'launch', 'tool'].includes(command.type)) throw new Error('Unknown replay action.');
    if (command.type === 'launch' && (!Number.isFinite(command.x) || !Number.isFinite(command.y)
      || Math.hypot(command.x, command.y) > 100.02)) throw new Error('Invalid launch.');
    if (command.type === 'tool' && (!commandToolUse(command)
      || (command.operationId !== undefined && (typeof command.operationId !== 'string' || command.operationId.length === 0 || command.operationId.length > 160)))) throw new Error('Invalid tool.');
  }
}
export function toolContext(run: EndlessRun, command: Extract<ReplayCommand, { type: 'tool' }>): string {
  const use = commandToolUse(command);
  if (!use) throw new Error('Invalid tool.');
  return isCreativeTool(use.tool)
    ? `${run.state.tick}:${run.state.pocketId}:${canonicalToolUse(use)}`
    : `${run.state.tick}:${run.state.pocketId}:${use.tool}:${use.tool === 'teleport' ? use.pocketId : ''}`;
}
/** The checkpoint is trusted server state; client snapshots and scores never enter this function. */
export async function replayBatch(run: EndlessRun, cursor: ReplayCursor, batch: ReplayBatch,
  authorize: (command: Extract<ReplayCommand, { type: 'tool' }>, context: string) => Promise<void> = async () => { throw new Error('Paid receipt required.'); }): Promise<void> {
  validateBatch(batch, cursor.elapsed);
  for (const command of batch.commands) {
    while (cursor.elapsed < command.at) { stepEndless(run, cursor.aiming); cursor.elapsed++; }
    if (command.type === 'aim') {
      if (run.state.phase !== 'held' || cursor.aiming) throw new Error('Invalid aim.');
      cursor.aiming = true;
    } else if (command.type === 'cancel') cursor.aiming = false;
    else if (command.type === 'launch') {
      const legal = clampEndlessPull({ x: command.x, y: command.y }, run.state.position, run.cameraY, run.room.bounds);
      if (Math.abs(legal.x - command.x) > .02 || Math.abs(legal.y - command.y) > .02) throw new Error('Pull outside the playfield.');
      if (!cursor.aiming || !launchEndless(run, { x: command.x, y: command.y })) throw new Error('Invalid launch.');
      cursor.aiming = false;
    } else {
      if (command.operationId) await authorize(command, toolContext(run, command));
      const paid = !!command.operationId;
      const applied = applyEndlessTool(run, commandToolUse(command)!, paid);
      if (!applied) throw new Error('Invalid tool state.');
      cursor.aiming = false;
    }
  }
  while (cursor.elapsed < batch.to) { stepEndless(run, cursor.aiming); cursor.elapsed++; }
}
