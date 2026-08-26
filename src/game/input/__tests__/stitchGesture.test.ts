import { describe, expect, test } from '@jest/globals';

import {
  MINIMUM_STITCH_LENGTH,
  POCKET_STITCH_RADIUS,
  SPIKE_STITCH_RADIUS,
  createStitch,
  createPinchStitch,
  createValidPinchStitch,
  fabricPointToView,
  findStitchNearPoint,
  isValidStitchDrag,
  viewPointToFabric,
} from '../stitchGesture';
import type { Stitch } from '../../core/types';

const fabricBounds = { x: 0, y: 0, width: 1, height: 1.5 } as const;
const canvas = { width: 300, height: 450 } as const;

function horizontalStitch(id: string, y: number): Stitch {
  return createPinchStitch(id, { x: 0.25, y }, { x: 0.75, y });
}

describe('stitch gestures', () => {
  test('maps canvas pixels into canonical 1 x 1.5 fabric coordinates', () => {
    expect(viewPointToFabric({ x: 150, y: 225 }, canvas, fabricBounds)).toEqual(
      { x: 0.5, y: 0.75 },
    );
    expect(viewPointToFabric({ x: -30, y: 600 }, canvas, fabricBounds)).toEqual(
      { x: 0, y: 1.5 },
    );
  });

  test('round-trips canonical coordinates through the canvas transform', () => {
    const fabricPoint = { x: 0.72, y: 1.125 };
    const viewPoint = fabricPointToView(fabricPoint, canvas, fabricBounds);

    expect(viewPoint).toEqual({ x: 216, y: 337.5 });
    expect(viewPointToFabric(viewPoint, canvas, fabricBounds)).toEqual(
      fabricPoint,
    );
  });

  test('creates a fixed pinch from quantized endpoints and integer thread cost', () => {
    const stitch = createPinchStitch(
      'quantized',
      { x: 0.12349, y: 0.23451 },
      { x: 0.81237, y: 1.31234 },
    );

    expect(stitch).toEqual({
      id: 'quantized',
      type: 'pinch',
      start: { x: 0.12353515625, y: 0.234619140625 },
      end: { x: 0.812255859375, y: 1.312255859375 },
      tension: 1,
      radius: SPIKE_STITCH_RADIUS,
      threadCost: 128,
    });
    expect(Number.isInteger(stitch.threadCost)).toBe(true);
  });

  test('creates a pocket with the canonical input radius', () => {
    const stitch = createStitch(
      'pocket',
      'pocket',
      { x: 0.25, y: 0.5 },
      { x: 0.5, y: 0.5 },
    );

    expect(stitch).toMatchObject({
      id: 'pocket',
      type: 'pocket',
      tension: 1,
      radius: POCKET_STITCH_RADIUS,
      threadCost: 25,
    });
  });

  test('rejects short drags and accepts the exact minimum length', () => {
    const start = { x: 0.2, y: 0.2 };

    expect(
      isValidStitchDrag(start, {
        x: start.x + MINIMUM_STITCH_LENGTH - 0.001,
        y: start.y,
      }),
    ).toBe(false);
    expect(
      isValidStitchDrag(start, {
        x: start.x + MINIMUM_STITCH_LENGTH,
        y: start.y,
      }),
    ).toBe(true);
  });

  test('rejects a drag that falls below the minimum after quantization', () => {
    const start = { x: 0.0002, y: 0.2 };
    const end = { x: 0.12020001, y: 0.2 };

    expect(isValidStitchDrag(start, end)).toBe(true);
    expect(createValidPinchStitch('boundary', start, end)).toBeNull();
  });

  test('returns the closest stitch inside the removal tolerance', () => {
    const closest = horizontalStitch('closest', 0.49);
    const fartherButNewer = horizontalStitch('farther', 0.56);

    expect(
      findStitchNearPoint(
        [closest, fartherButNewer],
        { x: 0.5, y: 0.5 },
        0.08,
      ),
    ).toBe(closest);
  });

  test('uses newest-first ordering for equal-distance stitches and misses outside tolerance', () => {
    const older = horizontalStitch('older', 0.45);
    const newer = horizontalStitch('newer', 0.55);

    expect(
      findStitchNearPoint([older, newer], { x: 0.5, y: 0.5 }, 0.08),
    ).toBe(newer);
    expect(
      findStitchNearPoint([older, newer], { x: 0.5, y: 0.7 }, 0.08),
    ).toBeNull();
  });
});
