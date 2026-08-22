import { describe, expect, test } from '@jest/globals';

import { getGamePalette } from '../gamePalette';
import { highContrastColors } from '../tokens';

describe('game palette', () => {
  test('uses the existing textile palette by default', () => {
    expect(getGamePalette(false)).toMatchObject({
      fabricBase: '#EDDFC4',
      stitch: '#A93238',
      travelerInner: '#619AA0',
    });
  });

  test('deepens critical outlines and gameplay colors in high contrast', () => {
    const standard = getGamePalette(false);
    const contrast = getGamePalette(true);

    expect(contrast.stitch).toBe(highContrastColors.thread);
    expect(contrast.frame).toBe(highContrastColors.fabricOutline);
    expect(contrast.routeSuccess).not.toBe(standard.routeSuccess);
    expect(contrast.travelerInner).not.toBe(standard.travelerInner);
  });
});
