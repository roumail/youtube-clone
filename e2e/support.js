// Shared test fixtures and helpers.
// Rule: wait on observable state, never on time. No waitForTimeout anywhere.
import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { COVERAGE, coverageReport } from './coverage.js';
import { readFileSync, statSync } from 'node:fs';

export { expect };

export const PIN = '1234';
export const WRONG_PIN = '9999';

export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');

// Generated in CI (not committed). Served by the test server (repo root) under /fixtures/out/.
export const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', 'fixtures', 'out');
export const fixtureUrl = (name) => `/fixtures/out/${name}/${name}.mpd`;
export const fixtureContainer = (name) => path.join(FIXTURES_DIR, `${name}.kidsvideo`);
// Loose parts of a fixture, only for a test that checks loose files are refused.
export const fixtureParts = (name) =>
  [`${name}.mpd`, 'video.mp4', 'audio.mp4', 'poster.jpg'].map((f) => path.join(FIXTURES_DIR, name, f));

export const test = base.extend({
  // Optional features seeded for a fresh install, unless the app already has
  // flags. Tests that aren't about the watch-time limit start with it switched
  // off (as a parent can in Settings), so a first play doesn't ask for a
  // budget. Feature files about it use test.use({ features: null }) to get the
  // app's real defaults.
  features: [{ watchTimeLimit: false }, { option: true }],

  // Capture Media Session handlers the app registers, so tests can fire
  // "play" as if from headphones / lock screen. No hooks needed in the app.
  // Every test sees a wide-gamut (P3) screen, like the family's MacBook and
  // iPad. Shaka changes its track choices on such screens.
  page: async ({ page, features, browserName }, use) => {
    // Coverage of app/ (CI sets COVERAGE): Chromium only, whole test incl. reloads.
    // Chromium drops a page's coverage when it navigates, so it's saved before
    // every goto/reload and recording starts again.
    const collect = COVERAGE && browserName === 'chromium';
    const saveCoverage = async () => {
      const entries = await page.coverage.stopJSCoverage();
      if (entries.length) await coverageReport().add(entries);
    };
    if (collect) {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      for (const method of ['goto', 'reload']) {
        const original = page[method].bind(page);
        page[method] = async (...args) => {
          await saveCoverage();
          await page.coverage.startJSCoverage({ resetOnNavigation: false });
          return original(...args);
        };
      }
    }
    if (features) {
      await page.addInitScript((f) => {
        try {
          if (!localStorage.getItem('features')) localStorage.setItem('features', JSON.stringify(f));
        } catch {
          // pages without storage (e.g. about:blank) have no app to configure
        }
      }, features);
    }
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/color-gamut:\s*p3|dynamic-range:\s*high/.test(q)
        ? { matches: true, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }
        : original(q));
    });
    await page.addInitScript(() => {
      window.__mediaSessionHandlers = {};
      const ms = navigator.mediaSession;
      if (ms) {
        const original = ms.setActionHandler.bind(ms);
        ms.setActionHandler = (action, handler) => {
          window.__mediaSessionHandlers[action] = handler;
          return original(action, handler);
        };
      }
    });
    // Any Content Security Policy
    // violation or uncaught page error fails the test, whatever it was testing.
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) problems.push(`CSP: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    await use(page);
    if (collect) await saveCoverage();
    expect(problems, 'CSP violations / uncaught page errors').toEqual([]);
  },

  // A PIN already exists, so first-run setup is skipped. Only seeds once, so a
  // test that changes the PIN keeps its change across reloads.
  pinSet: async ({ page }, use) => {
    await page.addInitScript(([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    }, ['pin.sha256', sha256Hex(PIN)]);
    await use(PIN);
  },

  // Arrange via API: store fixtures through Shaka directly, bypassing the
  // import UI (which has its own spec). Call after the app has booted.
  seedLibrary: async ({ page }, use) => {
    await use(async (...names) => {
      for (const name of names) {
        await page.evaluate(async ({ url, title, posterUrl }) => {
          const blob = await (await fetch(posterUrl)).blob();
          const poster = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(blob);
          });
          const storage = new shaka.offline.Storage();
          // Same rule as the app: never Shaka's default picker,
          // which drops SDR video on P3 screens (emulated for every test).
          storage.configure({ offline: {
            trackSelectionCallback: async (tracks) => tracks.filter((t) => t.type === 'variant').slice(0, 1),
          } });
          let stored;
          try {
            // Shaka needs an absolute URI (it picks the network plugin by scheme).
            stored = await storage.store(new URL(url, location.href).href, { title, poster }).promise;
          } catch (e) {
            // Shaka's compiled errors stringify to nothing useful; surface code + data.
            throw new Error(`seedLibrary: storing "${title}" failed: Shaka ${e.code} ${JSON.stringify(e.data ?? e.message)}`);
          } finally {
            await storage.destroy();
          }
          if (!stored.size) throw new Error(`seedLibrary: "${title}" stored 0 bytes`);
        }, { url: fixtureUrl(name), title: name, posterUrl: `/fixtures/out/${name}/poster.jpg` });
      }
      await page.reload();
      await appReady(page);
    });
  },
});

// ---------- helpers ----------

export async function appReady(page) {
  await expect(page.getByTestId('app')).toHaveAttribute('data-ready', 'true');
}

export async function goto(page, route) {
  await page.goto(`./${route}`);
  await appReady(page);
}

export async function enterPin(page, pin) {
  const prompt = page.getByTestId('pin-prompt');
  await expect(prompt).toBeVisible();
  await prompt.getByTestId('pin-input').fill(pin);
  await prompt.getByTestId('pin-submit').click();
}

export async function openVideo(page, title) {
  await page.getByTestId('library-item').filter({ hasText: title }).click();
  await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
}

export const playerState = (page) => page.getByTestId('screen-player');
const video = (page) => page.getByTestId('player-video');
const currentTime = (page) => video(page).evaluate((v) => v.currentTime);

// "Playing" = state says so AND media time actually advances.
export async function expectPlaying(page) {
  await expect(playerState(page)).toHaveAttribute('data-state', 'playing');
  const t0 = await currentTime(page);
  await expect.poll(() => currentTime(page)).toBeGreaterThan(t0);
}

// "Not playing" = element paused AND media time does not move across
// several rendered frames. A paused video never advances, so this has no race.
export async function expectNotPlaying(page) {
  await expect.poll(() => video(page).evaluate((v) => v.paused)).toBe(true);
  const moved = await video(page).evaluate(async (v) => {
    const t0 = v.currentTime;
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    return v.currentTime !== t0;
  });
  expect(moved).toBe(false);
}

// Simulate the app being backgrounded / foregrounded.
export async function setVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

// Model the iPhone's on-screen keyboard: while a text field has
// focus, window.visualViewport is shorter by the keyboard's height, as iPhone
// Safari reports it; it closes ≈300 ms after the field loses focus. The page itself doesn't move. Call before goto().
// The device's storage as the browser reports it (navigator.storage.estimate):
// `free` bytes left for the app. Call before the app loads.
export async function freeSpace(page, free) {
  await page.addInitScript((bytes) => {
    Object.defineProperty(navigator.storage, 'estimate', {
      configurable: true,
      value: async () => ({ usage: 0, quota: bytes }),
    });
  }, free);
}

// Shaka's own size guess for a fixture: declared bitrates x duration.
export function declaredSize(name) {
  const mpd = readFileSync(path.join(FIXTURES_DIR, name, `${name}.mpd`), 'utf8');
  const seconds = Number(/mediaPresentationDuration="PT([\d.]+)S"/.exec(mpd)[1]);
  const bitrate = [...mpd.matchAll(/bandwidth="(\d+)"/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  return (bitrate * seconds) / 8;
}

export const containerSize = (name) => statSync(fixtureContainer(name)).size;

export async function onScreenKeyboard(page) {
  await page.addInitScript(() => {
    const fake = new EventTarget();
    let keyboard = 0;
    const keyboardHeight = () => (window.innerWidth > window.innerHeight ? 200 : 300);
    Object.defineProperties(fake, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight - keyboard },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      pageTop: { get: () => window.scrollY },
      pageLeft: { get: () => window.scrollX },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
    const typing = (el) => el instanceof HTMLInputElement && !['range', 'file', 'checkbox', 'radio', 'button', 'submit'].includes(el.type);
    const set = (h) => { if (h !== keyboard) { keyboard = h; fake.dispatchEvent(new Event('resize')); } };
    document.addEventListener('focusin', (e) => { if (typing(e.target)) set(keyboardHeight()); });
    // Like the real keyboard, it slides away after the tap that took focus
    // away has landed (≈300 ms), not in the middle of it.
    document.addEventListener('focusout', (e) => {
      if (typing(e.target)) setTimeout(() => { if (!typing(document.activeElement)) set(0); }, 300);
    });
    window.addEventListener('resize', () => fake.dispatchEvent(new Event('resize')));
  });
}

// Fire a Media Session action as the OS would (headphones, lock screen, media keys).
export async function mediaSessionAction(page, action) {
  await page.evaluate((a) => window.__mediaSessionHandlers[a]?.({ action: a }), action);
}

// Tap play, enter the PIN, and wait until media time actually advances.
export async function startPlaying(page) {
  await page.getByTestId('play-button').click();
  await enterPin(page, PIN);
  await expectPlaying(page);
}
