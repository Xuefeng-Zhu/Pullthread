/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';

const music = readFileSync(
  join(process.cwd(), 'assets', 'audio', 'playful-climb-loop.wav'),
);

describe('generated music asset', () => {
  test('is a 24-second stereo 44.1 kHz PCM WAV', () => {
    expect(music.toString('ascii', 0, 4)).toBe('RIFF');
    expect(music.toString('ascii', 8, 12)).toBe('WAVE');
    expect(music.readUInt16LE(20)).toBe(1);
    expect(music.readUInt16LE(22)).toBe(2);
    expect(music.readUInt32LE(24)).toBe(44_100);
    expect(music.readUInt16LE(34)).toBe(16);
    expect(music.readUInt32LE(40)).toBe(44_100 * 24 * 4);
  });

  test('is quietly mastered without clipping or a boundary click', () => {
    let peak = 0;
    for (let offset = 44; offset < music.length; offset += 2) {
      peak = Math.max(peak, Math.abs(music.readInt16LE(offset)));
    }

    expect(peak / 32_767).toBeGreaterThanOrEqual(0.179);
    expect(peak / 32_767).toBeLessThanOrEqual(0.181);

    const firstLeft = music.readInt16LE(44);
    const firstRight = music.readInt16LE(46);
    const lastLeft = music.readInt16LE(music.length - 4);
    const lastRight = music.readInt16LE(music.length - 2);
    expect(Math.abs(firstLeft - lastLeft)).toBeLessThan(64);
    expect(Math.abs(firstRight - lastRight)).toBeLessThan(64);
  });
});
