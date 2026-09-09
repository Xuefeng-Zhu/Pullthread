import type { ToolKind } from '../../commerce/contracts';
import type { EndlessRun } from './endless';

export const FREE_TOOL_CAPACITY = 3;

/** Each entry is one unspent charge, ordered from oldest pickup to newest. */
export function grantFreeTool(run: EndlessRun, kind: ToolKind): ToolKind | undefined {
  let replacedKind: ToolKind | undefined;
  if ((run.generationVersion ?? 1) >= 6) {
    const queue = run.freeToolQueue;
    if (!queue) throw new Error('Missing free tool inventory order.');
    if (queue.length === FREE_TOOL_CAPACITY) {
      replacedKind = queue.shift()!;
      run.inventory[replacedKind] -= 1;
    }
    queue.push(kind);
  }
  run.inventory[kind] += 1;
  return replacedKind;
}

/** Using a kind consumes its oldest charge; prepared effects occupy no slot. */
export function spendFreeTool(run: EndlessRun, kind: ToolKind): boolean {
  if (run.inventory[kind] <= 0) return false;
  if ((run.generationVersion ?? 1) >= 6) {
    const index = run.freeToolQueue?.indexOf(kind) ?? -1;
    if (index < 0) return false;
    run.freeToolQueue!.splice(index, 1);
  }
  run.inventory[kind] -= 1;
  return true;
}
