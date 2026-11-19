// Feature: Works offline — once installed and filled, no network is needed.
import { test, expect, goto, openVideo, startPlaying } from '../../support.js';

test.describe('Feature: Works offline', () => {
  // Playwright's offline switch cuts the page's network but not its service
  // worker's, so the server must be unreachable for both.
  test('Scenario: the app and a stored video work with no network', async ({ page, context, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored and the app has loaded once', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await page.evaluate(() => navigator.serviceWorker.ready);
    });
    await test.step('When the server can no longer be reached, by the app or its service worker, and I reopen the app', async () => {
      await context.route('**/*', (route) => route.abort('internetdisconnected'));
      await page.reload();
    });
    await test.step('Then the app opens from its offline copy, "tiny" is listed and plays after the PIN', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
      await openVideo(page, 'tiny');
      await startPlaying(page);
    });
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
