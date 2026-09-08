module.exports = {
  preset: 'jest-expo',
  testEnvironment: '@shopify/react-native-skia/jestEnv.js',
  testPathIgnorePatterns: ['/node_modules/', '/worker/'],
  setupFilesAfterEnv: [
    '@shopify/react-native-skia/jestSetup.js',
    '<rootDir>/jest.setup.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|@react-navigation/.*|react-native-worklets|react-native-reanimated|react-native-gesture-handler|@shopify/react-native-skia)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
};
