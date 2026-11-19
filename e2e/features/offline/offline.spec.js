// Feature: Works offline — once installed and filled, no network is needed.
import { spawn } from 'node:child_process';
import { test, expect, goto, appReady, openVideo, startPlaying } from '../../support.js';

test.describe('Feature: Works offline', () => {
  // The app comes from a test server of its own, which is then stopped: routing
  // requests or Playwright's offline switch leave the service worker's own
  // requests alone, so only a server that is really gone tests its offline copy.
  test('Scenario: the app and a stored video work with no network', async ({ page, pinSet, seedLibrary }, testInfo) => {
    const port = 4300 + testInfo.parallelIndex;
    const server = spawn(process.execPath, ['e2e/server.js', String(port)], { stdio: 'ignore' });
    try {
      await test.step('Given "tiny" is stored and the app has loaded once', async () => {
        await expect.poll(() => fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.ok, () => false)).toBe(true);
        await page.goto(`http://127.0.0.1:${port}/app/#/library`);
        await appReady(page);
        await seedLibrary('tiny');
        await page.evaluate(() => navigator.serviceWorker.ready);
      });
      let reopened;
      await test.step('When the server goes away and I reopen the app', async () => {
        server.kill();
        await new Promise((resolve) => { server.once('exit', resolve); });
        reopened = await page.reload();
      });
      await test.step('Then the app opens from its offline copy, "tiny" is listed and plays after the PIN', async () => {
        expect(reopened.fromServiceWorker()).toBe(true);
        await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
        await openVideo(page, 'tiny');
        await startPlaying(page);
      });
    } finally {
      server.kill();
    }
  });

  test('Scenario: an app update deletes the old version\'s cached files, never the videos', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored and an older app version left its files in the cache "app-v1"', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        await (await caches.open('app-v1')).put('old-app.js', new Response('// old version'));
      });
    });
    await test.step('When the app\'s new version takes over', async () => {
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).unregister());
      await page.reload();
      await page.evaluate(() => navigator.serviceWorker.ready);
    });
    await test.step('Then only the current version\'s cache "app-v2" is left', async () => {
      await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['app-v2']);
    });
    await test.step('And "tiny" is still in the library', async () => {
      await page.reload();
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });
});
