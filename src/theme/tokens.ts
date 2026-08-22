import type { ViewStyle } from 'react-native';

/** Warm textile-storybook design tokens shared by React Native and Skia. */
export const colors = {
  canvas: '#FBF1D9',
  surface: '#FFF9EA',
  surfaceRaised: '#FFFDF5',
  surfacePressed: '#F0DFC0',
  fabricBase: '#E7C98F',
  fabricShadow: '#B78D5D',
  fabricHighlight: '#F6E5B9',
  textPrimary: '#34272A',
  textSecondary: '#705B5D',
  textOnDark: '#FFF9EA',
  border: '#9D765F',
  borderSubtle: '#D8B995',
  thread: '#B83E50',
  threadPreview: '#D96877',
  threadHighlight: '#FFF2D5',
  traveler: '#586F8C',
  travelerDetail: '#E9D7B2',
  goal: '#3F765C',
  success: '#3F765C',
  warning: '#BE7A2D',
  failure: '#9A3C45',
  focus: '#315D82',
  scrim: 'rgba(52, 39, 42, 0.48)',
  transparent: 'rgba(0, 0, 0, 0)',
} as const;

export const highContrastColors = {
  thread: '#7A1022',
  threadPreview: '#A51A33',
  goal: '#075238',
  focus: '#003F73',
  fabricOutline: '#4A2E2A',
} as const;

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
  pill: 999,
} as const;

export const borderWidths = {
  hairline: 1,
  regular: 2,
  emphasized: 3,
  thread: 4,
} as const;

export const touchTargets = {
  minimum: 44,
  comfortable: 48,
  primary: 56,
} as const;

export const opacity = {
  disabled: 0.42,
  secondary: 0.68,
  overlay: 0.82,
  opaque: 1,
} as const;

export const motion = {
  instant: 80,
  quick: 140,
  standard: 220,
  deliberate: 360,
  flourish: 620,
} as const;

export const shadows = {
  soft: {
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 3,
        blurRadius: 8,
        spreadDistance: 0,
        color: 'rgba(52, 39, 42, 0.14)',
      },
    ],
    elevation: 3,
  },
  raised: {
    boxShadow: [
      {
        offsetX: 0,
        offsetY: 6,
        blurRadius: 14,
        spreadDistance: 0,
        color: 'rgba(52, 39, 42, 0.18)',
      },
    ],
    elevation: 7,
  },
} as const satisfies Record<'raised' | 'soft', ViewStyle>;

export const tokens = {
  borderWidths,
  colors,
  highContrastColors,
  motion,
  opacity,
  radii,
  shadows,
  spacing,
  touchTargets,
} as const;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
