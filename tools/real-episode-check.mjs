// Manual check (not part of CI): store and play a REAL prepared episode in the
// spike, using the locally installed Google Chrome, headed (so the browser sees
// the real display, e.g. a P3 MacBook screen).
//
//   node tools/real-episode-check.mjs "prepared/The Snowy Day" [spike-url]
//
// Prints every check row plus the spike log, and saves a screenshot next to
// the episode folder's parent as real-episode-check.png. Nothing is uploaded:
// files go from disk straight into this browser profile's storage.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const folder = process.argv[2];
const url = process.argv[3] ?? 'https://www.rohailtaimour.com/youtube-clone/spike/';
if (!folder || !fs.existsSync(folder)) {
  console.error('usage: node tools/real-episode-check.mjs <prepared-episode-folder> [spike-url]');
  process.exit(2);
}
const files = fs.readdirSync(folder).filter((f) => !f.startsWith('.')).map((f) => path.join(folder, f));

// Fresh throwaway profile: no stale service worker or old entries.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-check-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: null });
const page = context.pages()[0] ?? await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.${m.type()}] ${m.text()}`); });

const row = (id) => page.getByTestId(`check-${id}`);
const read = async (id) => `${await row(id).getAttribute('data-result')}  ${(await row(id).textContent()).trim()}`;
const waitResult = (id, ms) => page.waitForFunction(
  (sel) => !['pending'].includes(document.querySelector(sel)?.dataset.result),
  `[data-testid="check-${id}"]`, { timeout: ms },
);

try {
  await page.goto(url);
  await waitResult('shaka', 30_000);
  const version = (await page.locator('p.note b').textContent().catch(() => '')) || '(no version marker)';
  console.log(`spike: ${url} — ${version}`);
  console.log(`picking ${files.length} files from ${folder}`);

  const started = Date.now();
  await page.getByTestId('spike-files').setInputFiles(files);
  await waitResult('store', 15 * 60_000);
  console.log(`store finished after ${((Date.now() - started) / 1000).toFixed(1)} s`);

  if ((await row('store').getAttribute('data-result')) === 'pass') {
    await page.getByTestId('spike-play').first().click();
    await waitResult('play', 60_000);
  }

  for (const id of ['standalone', 'mse', 'shaka', 'sw', 'persist', 'quota', 'store', 'play', 'codec-probe']) {
    console.log(`\n[${id}] ${await read(id)}`);
  }
  console.log(`\n--- spike log ---\n${await page.getByTestId('spike-log').textContent()}`);
  const shot = path.join(path.dirname(path.resolve(folder)), 'real-episode-check.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`screenshot: ${shot}`);
} finally {
  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
