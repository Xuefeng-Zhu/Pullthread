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
    }
  | {
      readonly status: 'failure';
      readonly reason: FailureReason;
      readonly tick: number;
      readonly completionMs: number;
      readonly hazardId?: string;
    };

export type SimulationPhase =
  | 'planning'
  | 'running'
  | 'succeeded'
  | 'failed';
