// Smoke: the pinned Chrome can play our codecs, and the 4 screens load.
// Nothing is played here. Active from step 4 of the working agreement.
import { test, expect, goto } from '../support.js';

test.describe('codec canary', () => {
  test('pinned Chrome supports H.264 + AAC via Media Source Extensions', async ({ page }) => {
    await test.step('Given a blank page in the pinned browser', async () => {
      await page.goto('about:blank');
    });
    await test.step('Then H.264 and AAC are supported for MSE playback', async () => {
      const support = await page.evaluate(() => ({
        h264: MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
        aac: MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'),
      }));
      expect(support).toEqual({ h264: true, aac: true });
    });
  });
});

test.describe('the 4 screens load', () => {
  test('first launch asks to set up Face ID', async ({ page }) => {
    await test.step('Given a fresh install', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the unlock prompt asks to set up Face ID', async () => {
      await expect(page.getByTestId('unlock-prompt')).toBeVisible();
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'setup');
    });
  });

  test('library screen loads', async ({ page, setUp }) => {
    await test.step('Given Face ID is set up and the library is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('And without a release (local/CI) the version label says "dev"', async () => {
      await expect(page.getByTestId('app-version')).toHaveText('dev');
    });
    await test.step('Then the library screen shows its empty state', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
    });
  });

  test('player screen loads', async ({ page, setUp }) => {
    await test.step('Given Face ID is set up', async () => {
      await goto(page, '#/player/does-not-exist');
    });
    await test.step('Then the player screen loads and reports an error for an unknown video', async () => {
      await expect(page.getByTestId('screen-player')).toBeVisible();
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'error');
    });
  });

  test('settings screen loads, unlocked by Face ID', async ({ page, setUp }) => {
    await test.step('Given Face ID is set up', async () => {
      await goto(page, '#/settings');
    });
    await test.step('Then settings is shown, unlocked after Face ID', async () => {
      await expect(page.getByTestId('screen-settings')).toBeVisible();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });
});
