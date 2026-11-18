// Manual check (not CI): add and play a REAL prepared episode in the real app,
// using the locally installed Google Chrome in a visible window (so it runs on
// the real display, e.g. a P3 MacBook screen) — the same flow as on the iPad.
//
//   node tools/real-episode-check.mjs "prepared/The Snowy Day" [app-url]
//
// Uses a fresh throwaway browser profile with a throwaway PIN. Nothing is
// uploaded: files go from disk straight into that profile's storage.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const folder = process.argv[2];
const url = process.argv[3] ?? 'https://www.rohailtaimour.com/youtube-clone/';
if (!folder || !fs.existsSync(folder)) {
  console.error('usage: node tools/real-episode-check.mjs <prepared-episode-folder> [app-url]');
  process.exit(2);
}
const files = fs.readdirSync(folder).filter((f) => !f.startsWith('.')).map((f) => path.join(folder, f));
const PIN = '2580';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'episode-check-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: null });
const page = context.pages()[0] ?? await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

const id = (t) => page.getByTestId(t);
async function enterPin() {
  await id('pin-input').fill(PIN);
  await id('pin-submit').click();
}
const step = (msg) => console.log(`• ${msg}`);

let ok = false;
try {
  await page.goto(url);
  await page.waitForSelector('[data-testid="app"][data-ready="true"]');
  step(`app loaded: ${url}`);

  await enterPin(); await enterPin(); // first run: set + confirm
  await page.waitForSelector('[data-testid="pin-prompt"]', { state: 'hidden' });
  step('PIN set');

  const chooser = page.waitForEvent('filechooser');
  await id('add-video-button').click();
  await enterPin();
  await (await chooser).setFiles(files);
  const started = Date.now();
  await page.waitForFunction(() => ['done', 'error'].includes(
    document.querySelector('[data-testid="import-status"]').dataset.import), null, { timeout: 15 * 60_000 });
  const importState = await id('import-status').getAttribute('data-import');
  step(`import ${importState} after ${((Date.now() - started) / 1000).toFixed(1)} s: ${await id('import-status').textContent()}`);
  if (importState !== 'done') throw new Error('import failed');

  await id('library-item').first().click();
  await page.waitForSelector('[data-testid="screen-player"][data-state="paused"]', { timeout: 60_000 });
  await id('play-button').click();
  await enterPin();
  await page.waitForSelector('[data-testid="screen-player"][data-state="playing"]', { timeout: 60_000 });
  const t0 = await id('player-video').evaluate((v) => v.currentTime);
  await page.waitForFunction((t) => document.querySelector('[data-testid="player-video"]').currentTime > t + 1, t0, { timeout: 30_000 });
  step('playing (time advances)');
  await id('pause-button').click();
  await page.waitForSelector('[data-testid="screen-player"][data-state="paused"]');
  step('paused without a PIN prompt');
  ok = problems.length === 0;
} catch (e) {
  console.error(`FAILED: ${e.message}`);
} finally {
  const shot = path.join(path.dirname(path.resolve(folder)), 'real-episode-check.png');
  await page.screenshot({ path: shot }).catch(() => {});
  console.log(`screenshot: ${shot}`);
  if (problems.length) console.log(`problems:\n  ${problems.join('\n  ')}`);
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
console.log(ok ? 'RESULT: OK' : 'RESULT: FAILED');
process.exit(ok ? 0 : 1);
