import { describe, expect, test } from '@jest/globals';

import {
  circleInsideRect,
  closestSegmentParameter,
  distancePointToSegmentSquared,
  quantizePoint,
  smoothstep01,
} from '../geometry';

describe('geometry', () => {
  test('measures perpendicular and endpoint distance to a segment', () => {
    expect(distancePointToSegmentSquared(0.5, 0.25, 0, 0, 1, 0)).toBe(
      0.0625,
    );
    expect(distancePointToSegmentSquared(-1, 1, 0, 0, 1, 0)).toBe(2);
    expect(closestSegmentParameter(0.25, 1, 0, 0, 1, 0)).toBe(0.25);
  });

  test('treats a degenerate segment as a point', () => {
    expect(distancePointToSegmentSquared(4, 6, 1, 2, 1, 2)).toBe(25);
    expect(closestSegmentParameter(4, 6, 1, 2, 1, 2)).toBe(0);
  });

  test('smoothstep clamps outside its domain', () => {
    expect(smoothstep01(-2)).toBe(0);
    expect(smoothstep01(0.5)).toBe(0.5);
    expect(smoothstep01(3)).toBe(1);
  });

  test('quantizes replay coordinates', () => {
    expect(quantizePoint({ x: 0.12349, y: 0.98751 }, 0.001)).toEqual({
      x: 0.123,
      y: 0.988,
    });
  });

  test('tests the complete traveler disk against fabric bounds', () => {
    const bounds = { x: 0, y: 0, width: 1, height: 2 };
    expect(circleInsideRect(0.1, 0.1, 0.1, bounds)).toBe(true);
    expect(circleInsideRect(0.09, 0.1, 0.1, bounds)).toBe(false);
  });
});
