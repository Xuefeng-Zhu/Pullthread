const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['coverage/**', 'dist/**', 'web-build/**'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
]);
