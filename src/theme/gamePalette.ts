import { highContrastColors } from './tokens';

export interface GamePalette {
  readonly fabricBase: string;
  readonly fabricWeaveLight: string;
  readonly fabricWeaveDark: string;
  readonly grid: string;
  readonly frame: string;
  readonly routeSuccess: string;
  readonly routeFailure: string;
  readonly stitch: string;
  readonly stitchPreview: string;
  readonly stitchHighlight: string;
  readonly travelerOuter: string;
  readonly travelerInner: string;
  readonly travelerHole: string;
  readonly goalPetal: string;
  readonly goalPetalAccent: string;
  readonly goalFill: string;
  readonly goalHighlight: string;
  readonly goalCore: string;
}

const standardPalette: GamePalette = {
  fabricBase: '#EDDFC4',
  fabricWeaveLight: 'rgba(255,255,255,0.24)',
  fabricWeaveDark: 'rgba(62,50,38,0.08)',
  grid: 'rgba(87,67,49,0.24)',
  frame: '#1D4552',
  routeSuccess: 'rgba(49,93,95,0.58)',
  routeFailure: 'rgba(89,94,91,0.45)',
  stitch: '#A93238',
  stitchPreview: '#D45E56',
  stitchHighlight: 'rgba(255,209,176,0.58)',
  travelerOuter: '#214F59',
  travelerInner: '#619AA0',
  travelerHole: '#17333A',
  goalPetal: '#B98A2F',
  goalPetalAccent: '#315D5F',
  goalFill: '#C89A35',
  goalHighlight: '#E5BD53',
  goalCore: '#8B6828',
};

const contrastPalette: GamePalette = {
  fabricBase: '#FFF0C9',
  fabricWeaveLight: 'rgba(255,255,255,0.5)',
  fabricWeaveDark: 'rgba(45,25,18,0.2)',
  grid: 'rgba(50,27,20,0.48)',
  frame: highContrastColors.fabricOutline,
  routeSuccess: 'rgba(0,74,65,0.88)',
  routeFailure: 'rgba(31,36,38,0.78)',
  stitch: highContrastColors.thread,
  stitchPreview: highContrastColors.threadPreview,
  stitchHighlight: '#FFF4D0',
  travelerOuter: '#002E3B',
  travelerInner: '#168493',
  travelerHole: '#00171D',
  goalPetal: '#9A6200',
  goalPetalAccent: highContrastColors.goal,
  goalFill: '#E6A800',
  goalHighlight: '#FFD54D',
  goalCore: '#4D3000',
};

export function getGamePalette(highContrast: boolean): GamePalette {
  return highContrast ? contrastPalette : standardPalette;
}
