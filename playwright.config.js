// Pinned Chrome, plus WebKit iPad/iPhone profiles for tagged scenarios.
// CI runs it on Ubuntu in the pinned Playwright image; real Mac checks are local
// (tools/real-episode-check.mjs).
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
  // Line/branch coverage of app/ when COVERAGE is set (CI): e2e/coverage.js.
  globalSetup: './e2e/coverage.js',
  globalTeardown: './e2e/coverage-teardown.js',
  use: {
    // localhost, not 127.0.0.1: Face ID (WebAuthn) needs a host name.
    baseURL: LIVE ?? `http://localhost:${PORT}/app/`,
    // PW_HEADED=1 shows the browser window (e.g. when run on a Mac).
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
      grepInvert: /@iphone/,
    },
    // Safari's engine with an iPad profile, for behaviour that differs from
    // Chrome (e.g. what counts as "during a tap"). Only scenarios tagged @ipad.
    {
      name: 'ipad-webkit',
      grep: /@ipad/,
      use: { ...devices['iPad Pro 11 landscape'] },
    },
    // iPhone: Safari's engine with iPhone profiles, both
    // orientations. Only scenarios tagged @iphone.
    { name: 'iphone-portrait', grep: /@iphone/, use: { ...devices['iPhone 13'] } },
    { name: 'iphone-landscape', grep: /@iphone/, use: { ...devices['iPhone 13 landscape'] } },
  ],
  webServer: LIVE ? undefined : {
    command: `node e2e/server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
  },
});
