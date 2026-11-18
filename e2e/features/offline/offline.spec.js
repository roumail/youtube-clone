// Feature: Works offline — once installed and filled, no network is needed.
import { test, expect, goto, openVideo, startPlaying } from '../../support.js';

test.describe('Feature: Works offline', () => {
  test.fixme('Scenario: the app and a stored video work with no network', async ({ page, context, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored and the app has loaded once', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await page.evaluate(() => navigator.serviceWorker.ready);
    });
    await test.step('When the network goes away and I reopen the app', async () => {
      await context.setOffline(true);
      await page.reload();
    });
    await test.step('Then "tiny" is still listed and plays after the PIN', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
      await openVideo(page, 'tiny');
      await startPlaying(page);
    });
  });
});
