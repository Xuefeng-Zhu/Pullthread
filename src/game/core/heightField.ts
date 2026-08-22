import {
  clamp,
  closestSegmentParameter,
  distancePointToSegmentSquared,
  smoothstep01,
} from './geometry';
import type { Rect, Stitch } from './types';

export interface HeightField {
  readonly columns: number;
  readonly rows: number;
  readonly bounds: Rect;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly baseHeights: Float32Array;
  readonly heights: Float32Array;
  readonly offsetX: Float32Array;
  readonly offsetY: Float32Array;
  revision: number;
}

export interface SurfaceSample {
  height: number;
  gradientX: number;
  gradientY: number;
}

export interface PinchParameters {
  readonly ridgeHeight: number;
  readonly horizontalPull: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly maxHorizontalDisplacement: number;
}

export const DEFAULT_PINCH_PARAMETERS: PinchParameters = Object.freeze({
  ridgeHeight: 0.065,
  horizontalPull: 0.08,
  minHeight: -0.2,
  maxHeight: 0.2,
  maxHorizontalDisplacement: 0.025,
});

type BaseHeightSampler = (x: number, y: number) => number;

export function createHeightField(
  columns: number,
  rows: number,
  bounds: Rect,
  baseHeight?: BaseHeightSampler,
): HeightField {
  if (!Number.isInteger(columns) || columns < 2) {
    throw new RangeError('Height fields require at least two columns.');
  }
  if (!Number.isInteger(rows) || rows < 2) {
    throw new RangeError('Height fields require at least two rows.');
  }
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    throw new RangeError('Height-field bounds must have positive finite dimensions.');
  }

  const cellWidth = bounds.width / (columns - 1);
  const cellHeight = bounds.height / (rows - 1);
  const sampleCount = columns * rows;
  const baseHeights = new Float32Array(sampleCount);

  if (baseHeight) {
    for (let row = 0; row < rows; row += 1) {
      const y = bounds.y + row * cellHeight;
      const rowOffset = row * columns;

      for (let column = 0; column < columns; column += 1) {
        const x = bounds.x + column * cellWidth;
        const sampledHeight = baseHeight(x, y);

        if (!Number.isFinite(sampledHeight)) {
          throw new RangeError('Base-height sampler returned a non-finite value.');
        }
        baseHeights[rowOffset + column] = sampledHeight;
      }
    }
  }

  return {
    columns,
    rows,
    bounds,
    cellWidth,
    cellHeight,
    baseHeights,
    heights: baseHeights.slice(),
    offsetX: new Float32Array(sampleCount),
    offsetY: new Float32Array(sampleCount),
    revision: 0,
  };
}

function restoreBase(field: HeightField): void {
  field.heights.set(field.baseHeights);
  field.offsetX.fill(0);
  field.offsetY.fill(0);
}

export function resetHeightField(field: HeightField): void {
  restoreBase(field);
  field.revision += 1;
}

function assertPinchStitch(stitch: Stitch): void {
  if (stitch.type !== 'pinch') {
    throw new Error(`Stitch type "${stitch.type}" is not implemented yet.`);
  }
  if (!Number.isFinite(stitch.radius) || stitch.radius <= 0) {
    throw new RangeError('Pinch radius must be a positive finite number.');
  }
  if (!Number.isFinite(stitch.tension)) {
    throw new RangeError('Pinch tension must be finite.');
  }
}

function accumulatePinch(
  field: HeightField,
  stitch: Stitch,
  parameters: PinchParameters,
): void {
  const tension = clamp(stitch.tension, 0, 1);
  if (tension === 0) {
    return;
  }

  const midpointX = (stitch.start.x + stitch.end.x) * 0.5;
  const midpointY = (stitch.start.y + stitch.end.y) * 0.5;
  const radiusSquared = stitch.radius * stitch.radius;

  for (let row = 0; row < field.rows; row += 1) {
    const y = field.bounds.y + row * field.cellHeight;
    const rowOffset = row * field.columns;

    for (let column = 0; column < field.columns; column += 1) {
      const x = field.bounds.x + column * field.cellWidth;
      const distanceSquared = distancePointToSegmentSquared(
        x,
        y,
        stitch.start.x,
        stitch.start.y,
        stitch.end.x,
        stitch.end.y,
      );

      if (distanceSquared >= radiusSquared) {
        continue;
      }

      const distance = Math.sqrt(distanceSquared);
      const falloff = smoothstep01(1 - distance / stitch.radius);
      const segmentParameter = closestSegmentParameter(
        x,
        y,
        stitch.start.x,
        stitch.start.y,
        stitch.end.x,
        stitch.end.y,
      );
      const alongSegment =
        0.4 + 0.6 * (4 * segmentParameter * (1 - segmentParameter));
      const index = rowOffset + column;
      const pull = parameters.horizontalPull * tension * falloff;

      field.heights[index] +=
        parameters.ridgeHeight * tension * falloff * alongSegment;
      field.offsetX[index] += (midpointX - x) * pull;
      field.offsetY[index] += (midpointY - y) * pull;
    }
  }
}

function finalizeDeformation(
  field: HeightField,
  parameters: PinchParameters,
): void {
  const maximumDisplacement = parameters.maxHorizontalDisplacement;
  const maximumDisplacementSquared = maximumDisplacement * maximumDisplacement;

  for (let index = 0; index < field.heights.length; index += 1) {
    field.heights[index] = clamp(
      field.heights[index],
      parameters.minHeight,
      parameters.maxHeight,
    );

    const x = field.offsetX[index];
    const y = field.offsetY[index];
    const displacementSquared = x * x + y * y;

    if (
      maximumDisplacement > 0 &&
      displacementSquared > maximumDisplacementSquared
    ) {
      const scale = maximumDisplacement / Math.sqrt(displacementSquared);
      field.offsetX[index] = x * scale;
      field.offsetY[index] = y * scale;
    }
  }
}

export function applyPinchStitch(
  field: HeightField,
  stitch: Stitch,
  parameters: PinchParameters = DEFAULT_PINCH_PARAMETERS,
): void {
  assertPinchStitch(stitch);
  accumulatePinch(field, stitch, parameters);
  finalizeDeformation(field, parameters);
  field.revision += 1;
}

export function rebuildHeightField(
  field: HeightField,
  stitches: readonly Stitch[],
  parameters: PinchParameters = DEFAULT_PINCH_PARAMETERS,
  preview?: Stitch,
): void {
  for (const stitch of stitches) {
    assertPinchStitch(stitch);
  }
  if (preview) {
    assertPinchStitch(preview);
  }

  restoreBase(field);

  for (const stitch of stitches) {
    accumulatePinch(field, stitch, parameters);
  }
  if (preview) {
    accumulatePinch(field, preview, parameters);
  }

  finalizeDeformation(field, parameters);
  field.revision += 1;
}

export function sampleSurfaceInto(
  field: HeightField,
  x: number,
  y: number,
  output: SurfaceSample,
): void {
  const normalizedX = clamp(
    (x - field.bounds.x) / field.cellWidth,
    0,
    field.columns - 1,
  );
  const normalizedY = clamp(
    (y - field.bounds.y) / field.cellHeight,
    0,
    field.rows - 1,
  );
  const left = Math.min(Math.floor(normalizedX), field.columns - 2);
  const top = Math.min(Math.floor(normalizedY), field.rows - 2);
  const interpolationX = normalizedX - left;
  const interpolationY = normalizedY - top;
  const topLeftIndex = top * field.columns + left;
  const bottomLeftIndex = topLeftIndex + field.columns;
  const topLeft = field.heights[topLeftIndex];
  const topRight = field.heights[topLeftIndex + 1];
  const bottomLeft = field.heights[bottomLeftIndex];
  const bottomRight = field.heights[bottomLeftIndex + 1];
  const topHeight = topLeft + (topRight - topLeft) * interpolationX;
  const bottomHeight = bottomLeft + (bottomRight - bottomLeft) * interpolationX;

  output.height = Math.fround(
    topHeight + (bottomHeight - topHeight) * interpolationY,
  );
  output.gradientX = Math.fround(
    ((topRight - topLeft) * (1 - interpolationY) +
      (bottomRight - bottomLeft) * interpolationY) /
      field.cellWidth,
  );
  output.gradientY = Math.fround(
    ((bottomLeft - topLeft) * (1 - interpolationX) +
      (bottomRight - topRight) * interpolationX) /
      field.cellHeight,
  );
}

export function sampleSurface(
  field: HeightField,
  x: number,
  y: number,
): SurfaceSample {
  const output: SurfaceSample = { height: 0, gradientX: 0, gradientY: 0 };
  sampleSurfaceInto(field, x, y, output);
  return output;
}
