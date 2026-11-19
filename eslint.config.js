// Lint only the e2e specs. The key rule: no sleeping in tests.
import playwright from 'eslint-plugin-playwright';

export default [
  {
    files: ['e2e/**/*.js'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      // Drafted specs are intentionally test.fixme until their milestone.
      'playwright/no-skipped-test': 'off',
      // Steps assert through shared helpers (expectPlaying etc.).
      'playwright/expect-expect': 'off',
    },
  },
];
