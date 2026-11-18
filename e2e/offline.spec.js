// Rule: once installed and filled, the app works with no network at all.
import { test, expect, goto, enterPin, openVideo, expectPlaying, PIN } from './support.js';

test.fixme('the app and a stored video work offline', async ({ page, context, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" is stored and the app has been loaded once', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny');
    await page.evaluate(() => navigator.serviceWorker.ready);
  });
  await test.step('When the network goes away and I reopen the app', async () => {
    await context.setOffline(true);
    await page.reload();
  });
  await test.step('Then the library still shows "tiny"', async () => {
    await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
  });
  await test.step('And "tiny" plays after the PIN', async () => {
    await openVideo(page, 'tiny');
    await page.getByTestId('play-button').click();
    await enterPin(page, PIN);
    await expectPlaying(page);
  });
});
