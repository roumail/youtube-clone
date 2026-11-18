// Smoke: the pinned Chrome can play our codecs, and the 4 screens load.
// Nothing is played here. Active from step 4 of the working agreement.
import { test, expect, goto } from './support.js';

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
  test('first launch shows the PIN prompt in setup mode', async ({ page }) => {
    await test.step('Given a fresh install with no PIN set', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the PIN prompt asks to set a PIN', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
    });
  });

  test('library screen loads', async ({ page, pinSet }) => {
    await test.step('Given a PIN is set and the library is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the library screen shows its empty state', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
    });
  });

  test('player screen loads', async ({ page, pinSet }) => {
    await test.step('Given a PIN is set', async () => {
      await goto(page, '#/player/does-not-exist');
    });
    await test.step('Then the player screen loads and reports an error for an unknown video', async () => {
      await expect(page.getByTestId('screen-player')).toBeVisible();
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'error');
    });
  });

  test('settings screen loads locked behind the PIN', async ({ page, pinSet }) => {
    await test.step('Given a PIN is set', async () => {
      await goto(page, '#/settings');
    });
    await test.step('Then settings is shown locked with the PIN prompt in verify mode', async () => {
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    });
  });
});
