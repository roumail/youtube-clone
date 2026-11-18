// Pinned Chrome only (Playwright version pins the exact build). DESIGN.md §7.
// CI runs this on macOS, headed, to mirror the owner's Mac.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// LIVE_URL set (deploy.yml only): run e2e/live against the public site instead
// of the local test server. Otherwise the live checks are skipped.
const LIVE = process.env.LIVE_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  testIgnore: LIVE ? [] : ['**/live/**'],
  ...(LIVE ? { testDir: './e2e/live' } : {}),
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: LIVE ?? `http://127.0.0.1:${PORT}/app/`,
    // CI runs headed on macOS (PW_HEADED=1) to match the owner's Mac.
    headless: !process.env.PW_HEADED,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1180, height: 820 },
        hasTouch: true,
      },
    },
  ],
  webServer: LIVE ? undefined : {
    command: `node e2e/server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
  },
});
