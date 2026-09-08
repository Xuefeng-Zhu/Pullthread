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
  readonly sectionId?: string;
  readonly ascentRank?: number;
  readonly route?: 'safe' | 'reward' | 'recovery';
  /** Lifetime from first arrival, measured in deterministic simulation ticks. */
  readonly frayTicks?: number;
  /** An upright mouth on a decorative hoop. Unlike sway, its orbit survives a catch. */
  readonly orbit?: {
    readonly radius: number;
    readonly periodTicks: number;
    readonly phaseTicks: number;
    readonly direction?: 1 | -1;
  };
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
  /** Optional minimum outward rebound speed; ordinary cushions remain unboosted. */
  readonly springSpeed?: number;
}

export interface LaunchHazard {
  readonly id: string;
  readonly center: LaunchPoint;
  readonly radius: number;
  readonly visual?: 'scissors';
  readonly motion?: {
    readonly amplitude: number;
    readonly periodTicks: number;
    readonly phaseTicks: number;
    readonly axis?: 'x' | 'y';
  };
}

export interface LaunchPickup {
  readonly id: string;
  readonly kind: ToolKind;
  readonly center: LaunchPoint;
  readonly radius: number;
}

export interface LaunchWindZone {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly accelerationX: number;
}

export interface LaunchBarrier {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: 'solid' | 'tearable' | 'door' | 'thorns' | 'shutter';
  readonly phaseTicks?: number;
}

export interface LaunchSwitch {
  readonly id: string;
  readonly center: LaunchPoint;
  readonly radius: number;
  readonly doorIds: readonly string[];
  /** Optional landing activation also applies to Teleport. */
  readonly pocketId?: string;
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
  /** When present, side walls bounce the button; omitted keeps legacy lethal x bounds. */
  readonly sideWallRestitution?: number;
  readonly gravity: number;
  readonly startPocketId: string;
  readonly pockets: readonly LaunchPocket[];
  readonly bumpers: readonly LaunchBumper[];
  readonly hazards: readonly LaunchHazard[];
  readonly pickups?: readonly LaunchPickup[];
  readonly windZones?: readonly LaunchWindZone[];
  readonly barriers?: readonly LaunchBarrier[];
  readonly switches?: readonly LaunchSwitch[];
  readonly patch?: { readonly center: LaunchPoint; readonly radius: number };
}

export type LaunchFailure = 'hazard' | 'out_of_bounds' | 'timeout';

export type LaunchEvent =
  | { readonly type: 'launch'; readonly tick: number; readonly id: string }
  | { readonly type: 'bounce'; readonly tick: number; readonly id: string }
  | { readonly type: 'catch'; readonly tick: number; readonly id: string }
  | { readonly type: 'fray'; readonly tick: number; readonly id: string }
  | { readonly type: 'break'; readonly tick: number; readonly id: string }
  | { readonly type: 'switch'; readonly tick: number; readonly id: string }
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
  brokenBarrierIds?: string[];
  activatedSwitchIds?: string[];
  flightTicks: number;
  launches: number;
  /** The source opening is ignored until the button has left its receiver. */
  sourcePocketImmune: boolean;
  event?: LaunchEvent;
  failure?: LaunchFailure;
  /** Absolute expiry ticks; absent on legacy runs and before the first temporary catch. */
  pocketExpiryTicks?: Record<string, number>;
  /** Distinguishes a failed unraveling fall without changing legacy failure values. */
  frayedFall?: boolean;
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
