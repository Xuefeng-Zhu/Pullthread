import { describe, expect, test } from '@jest/globals';

import {
  applyPocketStitch,
  createHeightField,
  rebuildHeightField,
  resetHeightField,
  sampleSurface,
  type PinchParameters,
  type PocketParameters,
} from '../heightField';
import { calculateThreadCost } from '../scoring';
import type { Stitch } from '../types';

const bounds = { x: 0, y: 0, width: 1, height: 1 } as const;

function pinch(overrides: Partial<Stitch> = {}): Stitch {
  const start = overrides.start ?? { x: 0.25, y: 0.5 };
  const end = overrides.end ?? { x: 0.75, y: 0.5 };
  return {
    id: 'pinch',
    type: 'pinch',
    start,
    end,
    tension: 1,
    radius: 0.25,
    threadCost: calculateThreadCost(start, end),
    ...overrides,
  };
}

function pocket(overrides: Partial<Stitch> = {}): Stitch {
  const start = overrides.start ?? { x: 0.4, y: 0.5 };
  const end = overrides.end ?? { x: 0.6, y: 0.5 };
  return {
    id: 'pocket',
    type: 'pocket',
    start,
    end,
    tension: 1,
    radius: 0.3,
    threadCost: calculateThreadCost(start, end),
    ...overrides,
  };
}

describe('height field', () => {
  test('bilinearly samples height and its analytic gradient', () => {
    const field = createHeightField(2, 2, bounds, (x, y) => x + 2 * y);
    const sample = sampleSurface(field, 0.25, 0.75);

    expect(sample.height).toBeCloseTo(1.75, 6);
    expect(sample.gradientX).toBeCloseTo(1, 6);
    expect(sample.gradientY).toBeCloseTo(2, 6);
  });

  test('clamps samples at field edges without invalid cell indices', () => {
    const field = createHeightField(2, 2, bounds, (x, y) => x + 2 * y);
    expect(sampleSurface(field, -5, 5)).toEqual({
      height: 2,
      gradientX: 1,
      gradientY: 2,
    });
  });

  test('raises a symmetric ridge and pulls vertices toward its midpoint', () => {
    const field = createHeightField(9, 9, bounds);
    rebuildHeightField(field, [pinch()]);

    const center = sampleSurface(field, 0.5, 0.5).height;
    const above = sampleSurface(field, 0.5, 0.375).height;
    const below = sampleSurface(field, 0.5, 0.625).height;

    expect(center).toBeGreaterThan(0.06);
    expect(above).toBeCloseTo(below, 7);
    expect(sampleSurface(field, 0.5, 0.875).height).toBe(0);
    expect(field.offsetX[4 * field.columns + 3]).toBeGreaterThan(0);
    expect(field.offsetX[4 * field.columns + 5]).toBeLessThan(0);
  });

  test('zero tension leaves the surface untouched', () => {
    const field = createHeightField(9, 9, bounds);
    rebuildHeightField(field, [pinch({ tension: 0 })]);
    expect(Array.from(field.heights)).toEqual(Array.from(field.baseHeights));
  });

  test('overlapping stitches obey height and displacement clamps', () => {
    const field = createHeightField(9, 9, bounds);
    const parameters: PinchParameters = {
      ridgeHeight: 1,
      horizontalPull: 10,
      minHeight: -0.1,
      maxHeight: 0.1,
      maxHorizontalDisplacement: 0.01,
    };
    rebuildHeightField(field, [pinch(), pinch({ id: 'second' })], parameters);

    expect(Math.max(...field.heights)).toBeLessThanOrEqual(Math.fround(0.1));
    for (let index = 0; index < field.offsetX.length; index += 1) {
      expect(
        Math.hypot(field.offsetX[index], field.offsetY[index]),
      ).toBeLessThanOrEqual(0.010000001);
    }
  });

  test('creates a symmetric bounded pocket basin around the stitch midpoint', () => {
    const field = createHeightField(9, 9, bounds);
    const parameters: PocketParameters = {
      depth: 1,
      inwardPull: 10,
      minHeight: -0.08,
      maxHeight: 0.08,
      maxHorizontalDisplacement: 0.012,
    };

    applyPocketStitch(field, pocket(), parameters);

    expect(sampleSurface(field, 0.5, 0.5).height).toBeCloseTo(-0.08, 7);
    expect(sampleSurface(field, 0.375, 0.5).height).toBeCloseTo(
      sampleSurface(field, 0.625, 0.5).height,
      7,
    );
    expect(sampleSurface(field, 0.5, 0.875).height).toBe(0);
    expect(field.offsetX[4 * field.columns + 3]).toBeGreaterThan(0);
    expect(field.offsetX[4 * field.columns + 5]).toBeLessThan(0);
    for (let index = 0; index < field.offsetX.length; index += 1) {
      expect(
        Math.hypot(field.offsetX[index], field.offsetY[index]),
      ).toBeLessThanOrEqual(0.012000001);
    }
  });

  test('rebuilds mixed pinch and pocket inputs deterministically', () => {
    const first = createHeightField(9, 9, bounds);
    const second = createHeightField(9, 9, bounds);
    const stitches = [pinch(), pocket()];

    rebuildHeightField(first, stitches);
    rebuildHeightField(second, stitches);

    expect(Array.from(first.heights)).toEqual(Array.from(second.heights));
    expect(Array.from(first.offsetX)).toEqual(Array.from(second.offsetX));
    expect(Array.from(first.offsetY)).toEqual(Array.from(second.offsetY));
  });

  test('reset exactly restores the authored base field', () => {
    const field = createHeightField(9, 9, bounds, (_x, y) => -0.1 * y);
    rebuildHeightField(field, [pinch()]);
    resetHeightField(field);

    expect(Array.from(field.heights)).toEqual(Array.from(field.baseHeights));
    expect(field.offsetX.every((value) => value === 0)).toBe(true);
    expect(field.offsetY.every((value) => value === 0)).toBe(true);
  });
});
