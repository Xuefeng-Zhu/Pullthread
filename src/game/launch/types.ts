import type { ToolKind } from '../../commerce/contracts';

/** All geometry is in the fixed portrait world, with positive y downward. */
export interface LaunchPoint {
  x: number;
  y: number;
}

export interface LaunchPocket {
  readonly id: string;
  readonly center: LaunchPoint;
  readonly width: number;
  readonly kind: 'start' | 'checkpoint' | 'goal';
  /** Horizontal sine motion; the deterministic clock advances while aiming. */
  readonly motion?: {
    readonly amplitude: number;
    readonly periodTicks: number;
    readonly phaseTicks: number;
  };
}

export interface LaunchBumper {
  readonly id: string;
  readonly center: LaunchPoint;
  readonly radius: number;
  readonly restitution: number;
}

export interface LaunchHazard {
  readonly id: string;
  readonly center: LaunchPoint;
  readonly radius: number;
}

export interface LaunchPickup {
  readonly id: string;
  readonly kind: ToolKind;
  readonly center: LaunchPoint;
  readonly radius: number;
}

export interface LaunchRoom {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly hint: string;
  readonly bounds: {
    readonly width: number;
    readonly height: number;
    /** Optional absolute collision limits for a scrolling world. */
    readonly top?: number;
    readonly bottom?: number;
  };
  /** Omitted uses the practice-course timeout; null permits an endless flight. */
  readonly flightTimeoutTicks?: number | null;
  readonly gravity: number;
  readonly startPocketId: string;
  readonly pockets: readonly LaunchPocket[];
  readonly bumpers: readonly LaunchBumper[];
  readonly hazards: readonly LaunchHazard[];
  readonly pickups?: readonly LaunchPickup[];
  readonly patch?: { readonly center: LaunchPoint; readonly radius: number };
}

export type LaunchFailure = 'hazard' | 'out_of_bounds' | 'timeout';

export type LaunchEvent =
  | { readonly type: 'launch'; readonly tick: number; readonly id: string }
  | { readonly type: 'bounce'; readonly tick: number; readonly id: string }
  | { readonly type: 'catch'; readonly tick: number; readonly id: string }
  | { readonly type: 'complete'; readonly tick: number; readonly id: string }
  | { readonly type: 'patch'; readonly tick: number }
  | { readonly type: 'pickup'; readonly tick: number; readonly id: string; readonly kind: ToolKind; readonly convertedFrom?: 'revive' }
  | { readonly type: 'tool'; readonly tick: number; readonly id: string; readonly kind: ToolKind }
  | { readonly type: 'fail'; readonly tick: number; readonly reason: LaunchFailure };

export interface LaunchCheckpoint {
  readonly pocketId: string;
  readonly tick: number;
  readonly patchCollected: boolean;
}

/** Mutable state belongs exclusively to one session; room definitions are never changed. */
export interface LaunchState {
  tick: number;
  phase: 'held' | 'flying' | 'failed' | 'complete';
  position: LaunchPoint;
  previousPosition: LaunchPoint;
  velocity: LaunchPoint;
  pocketId: string;
  checkpoint: LaunchCheckpoint;
  patchCollected: boolean;
  /** Collected IDs within the retained room; endless owns the bounded award ledger. */
  pickupIds: string[];
  flightTicks: number;
  launches: number;
  /** The source opening is ignored until the button has left its receiver. */
  sourcePocketImmune: boolean;
  event?: LaunchEvent;
  failure?: LaunchFailure;
}

/** Applied only at the exact specified simulation tick while held at pocketId. */
export interface LaunchInput {
  readonly tick: number;
  readonly pocketId: string;
  readonly pull: LaunchPoint;
}

export interface LaunchClock {
  accumulator: number;
}
