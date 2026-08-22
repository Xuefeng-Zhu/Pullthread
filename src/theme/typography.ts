/** Font family names registered by @expo-google-fonts packages. */
export const fontFamilies = {
  display: 'Fraunces_600SemiBold',
  body: 'NunitoSans_400Regular',
  bodyMedium: 'NunitoSans_500Medium',
  bodySemibold: 'NunitoSans_600SemiBold',
  bodyBold: 'NunitoSans_700Bold',
} as const;

export const typography = {
  hero: {
    fontFamily: fontFamilies.display,
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: -0.5,
  },
  title: {
    fontFamily: fontFamilies.display,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.25,
  },
  heading: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0,
  },
  body: {
    fontFamily: fontFamilies.body,
    fontSize: 16,
    lineHeight: 23,
    letterSpacing: 0.1,
  },
  bodyStrong: {
    fontFamily: fontFamilies.bodySemibold,
    fontSize: 16,
    lineHeight: 23,
    letterSpacing: 0.1,
  },
  label: {
    fontFamily: fontFamilies.bodyBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.25,
  },
  caption: {
    fontFamily: fontFamilies.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.35,
  },
} as const;

export type TypographyStyle = keyof typeof typography;
