/** @jest-environment node */
import { describe, expect, test } from '@jest/globals';

import { getLaunchViewport } from '../viewport';
import { MAX_PULL } from '../simulation';

const bounds = { width: 360, height: 600 };

describe('full-screen launch projection', () => {
  test('native bottom insets before first layout keep the provisional projection invertible', () => {
    for (const size of [{ width: 1, height: 1 }, { width: 0, height: 0 }]) {
      const viewport = getLaunchViewport(size, bounds, 34);
      expect(viewport.scale).toBeGreaterThan(0);
      expect(Object.values(viewport).every(Number.isFinite)).toBe(true);
      expect(viewport.offsetY + bounds.height * viewport.scale).toBeLessThan(1);
      const provisionalX = viewport.offsetX + 80 * viewport.scale;
      expect((provisionalX - viewport.offsetX) / viewport.scale).toBeCloseTo(80);
    }
  });

  test.each([
    { width: 390, height: 844, bottom: 34 },
    { width: 320, height: 568, bottom: 12 },
  ])('fills portrait width with a pull gutter above the safe inset at $width × $height', ({ width, height, bottom }) => {
    const viewport = getLaunchViewport({ width, height }, bounds, bottom);
    expect(viewport.offsetX).toBeCloseTo(0);
    expect(viewport.scale * bounds.width).toBeCloseTo(width);
    expect(viewport.offsetY + bounds.height * viewport.scale).toBeLessThan(height - bottom);
    expect((height - bottom) / viewport.scale).toBeGreaterThanOrEqual(600);
  });

  test('short landscape screens keep the bank rise visible as well as the pull gutter', () => {
    const size = { width: 844, height: 390 };
    const viewport = getLaunchViewport(size, bounds, 34);
    expect((size.height - 34) / viewport.scale).toBeCloseTo(600);
    expect(viewport.offsetX).toBeGreaterThan(0);
    expect(viewport.offsetX * 2 + bounds.width * viewport.scale).toBeCloseTo(size.width);
    expect(viewport.offsetY).toBeLessThan(0);
    const startY = viewport.offsetY + 490 * viewport.scale;
    expect(startY).toBeGreaterThan(0);
    expect(startY).toBeLessThan(size.height - 34);
  });

  test('tall screens expose future world positions above the camera origin', () => {
    const viewport = getLaunchViewport({ width: 390, height: 844 }, bounds, 34);
    expect(viewport.offsetY).toBeGreaterThan(0);
    const nextPocketAboveOrigin = viewport.offsetY - 40 * viewport.scale;
    expect(nextPocketAboveOrigin).toBeGreaterThan(0);
    expect(nextPocketAboveOrigin).toBeLessThan(viewport.offsetY);
  });

  test.each([
    { width: 1022, height: 1280, bottom: 24 },
    { width: 844, height: 390, bottom: 34 },
  ])('keeps a 310-unit bank rise visible before release at $width × $height', ({ width, height, bottom }) => {
    const cameraY = -2400;
    const sourceY = cameraY + 480;
    const targetY = sourceY - 310;
    const viewport = getLaunchViewport({ width, height }, bounds, bottom);
    const screenY = (worldY: number) => viewport.offsetY + (worldY - cameraY) * viewport.scale;
    // Include the button above the opening and the fabric cup below it, so
    // visibility means more than a single target point surviving the clip.
    expect(screenY(targetY - 10)).toBeGreaterThan(0);
    expect(screenY(targetY + 35)).toBeLessThan(height - bottom);
    expect(screenY(targetY + 35)).toBeLessThan(screenY(sourceY));
    // On the wide portrait canvas, the entire opening also clears the HUD.
    if (height > width) expect(screenY(targetY - 10)).toBeGreaterThan(80);
  });

  test.each([
    { width: 390, height: 844, bottom: 34, cameraY: 0 },
    { width: 320, height: 568, bottom: 12, cameraY: -860 },
    { width: 1022, height: 1280, bottom: 24, cameraY: -2000 },
    { width: 844, height: 390, bottom: 34, cameraY: -3600 },
  ])('preserves aim coordinates and pull vectors after scrolling at $width × $height', ({ width, height, bottom, cameraY }) => {
    const viewport = getLaunchViewport({ width, height }, bounds, bottom);
    const point = { x: 80, y: cameraY + 490 };
    const pull = { x: -24, y: 72 };
    const screenPoint = {
      x: viewport.offsetX + point.x * viewport.scale,
      y: viewport.offsetY + (point.y - cameraY) * viewport.scale,
    };
    const screenEnd = {
      x: screenPoint.x + pull.x * viewport.scale,
      y: screenPoint.y + pull.y * viewport.scale,
    };
    expect((screenPoint.x - viewport.offsetX) / viewport.scale).toBeCloseTo(point.x);
    expect((screenPoint.y - viewport.offsetY) / viewport.scale + cameraY).toBeCloseTo(point.y);
    expect((screenEnd.x - screenPoint.x) / viewport.scale).toBeCloseTo(pull.x);
    expect((screenEnd.y - screenPoint.y) / viewport.scale).toBeCloseTo(pull.y);
  });

  test.each([
    { width: 320, height: 568, bottom: 12 },
    { width: 390, height: 844, bottom: 34 },
    { width: 1022, height: 1280, bottom: 24 },
    { width: 844, height: 390, bottom: 34 },
  ])('keeps the stretched fabric and finger clear of the bottom at $width × $height', ({ width, height, bottom }) => {
    const viewport = getLaunchViewport({ width, height }, bounds, bottom);
    for (const cameraY of [0, -2400]) {
      // Opening lip is at 490; later settled catches sit at 480.
      for (const lipY of [490, 480]) {
        const anchor = cameraY + lipY;
        const screenY = (worldY: number) => viewport.offsetY + (worldY - cameraY) * viewport.scale;
        expect(height - bottom - screenY(anchor + MAX_PULL + 35)).toBeGreaterThanOrEqual(30);
        // Begin at the bottom of the accepted pocket touch area, not only its center.
        expect(height - bottom - screenY(anchor + MAX_PULL + 52)).toBeGreaterThanOrEqual(20);
      }
    }
  });

  test('the extra pull space leaves the 360 × 600 physics bounds unchanged', () => {
    const viewport = getLaunchViewport({ width: 360, height: 600 }, bounds);
    expect(viewport).toEqual({ scale: 1, offsetX: 0, offsetY: -80 });
    expect(bounds).toEqual({ width: 360, height: 600 });
  });
});
