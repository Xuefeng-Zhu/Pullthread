export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MutablePoint {
  x: number;
  y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type StitchType = 'pinch' | 'pocket';

export interface Stitch {
  readonly id: string;
  readonly type: StitchType;
  readonly start: Point;
  readonly end: Point;
  /** Normalized tension. The technical spike always uses 1. */
  readonly tension: number;
  /** Radius of the deformation in canonical fabric coordinates. */
  readonly radius: number;
  /** Integer thread units, calculated when the stitch is committed. */
  readonly threadCost: number;
}

export interface GoalDefinition {
  readonly center: Point;
  readonly radius: number;
  readonly maxEntrySpeed: number;
}

export interface CircularHazard {
  readonly id: string;
  readonly type: 'hole' | 'thorn';
  readonly center: Point;
  readonly radius: number;
}

export type FabricType = 'felt' | 'silk' | 'elastic';

/** Optional route conditions that must be satisfied before entering the goal. */
export interface CompletionRequirements {
  readonly minimumStitches?: number;
  readonly minimumThreadUsed?: number;
  readonly requiredStitchTypes?: readonly StitchType[];
  readonly requiredFabricTypes?: readonly FabricType[];
  readonly requiredBumperIds?: readonly string[];
  readonly requireEveryStitchVisited?: boolean;
}

/** A rectangular material region. The first authored matching region wins. */
export interface FabricRegion {
  readonly id: string;
  readonly type: FabricType;
  readonly bounds: Rect;
}

export interface BumperDefinition {
  readonly id: string;
  readonly center: Point;
  readonly radius: number;
  /** Optional authored coefficient in the inclusive range 0...1. */
  readonly restitution?: number;
}

/** Backward-friendly descriptive alias for the currently circular bumper. */
export type CircularBumper = BumperDefinition;

export interface CollectibleDefinition {
  readonly id: string;
  readonly center: Point;
  readonly radius: number;
}

export interface TravelerDefinition {
  readonly start: Point;
  readonly radius: number;
}

export interface TravelerState {
  readonly radius: number;
  readonly position: MutablePoint;
  readonly previousPosition: MutablePoint;
  readonly velocity: MutablePoint;
}

export type FailureReason =
  | 'out_of_bounds'
  | 'hazard'
  | 'stuck'
  | 'timeout';

export type SimulationOutcome =
  | {
      readonly status: 'success';
      readonly tick: number;
      readonly completionMs: number;
      readonly collectedPatchId?: string;
    }
  | {
      readonly status: 'failure';
      readonly reason: FailureReason;
      readonly tick: number;
      readonly completionMs: number;
      readonly hazardId?: string;
      readonly collectedPatchId?: string;
    };

export type SimulationPhase =
  | 'planning'
  | 'running'
  | 'succeeded'
  | 'failed';
