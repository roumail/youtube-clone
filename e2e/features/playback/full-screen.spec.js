// Feature: Real full screen — a Full screen button in the player hides the
// browser around the app (owner request 2026-11-19, M14). The whole app goes
// full screen, never the <video> element, so the PIN prompt and our own
// controls stay in charge.
import { test, expect, goto, openVideo, enterPin, expectNotPlaying, expectPlaying, PIN } from '../../support.js';

const button = (page) => page.getByTestId('fullscreen-button');
const fullScreenElement = (page) => page.evaluate(() => document.fullscreenElement?.tagName ?? null);

test.describe('Feature: Real full screen', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
  });

  test('Scenario: the Full screen button hides the browser, and tapping it again brings it back', async ({ page }) => {
    await test.step('When I tap "Full screen"', async () => {
      await expect(button(page)).toHaveAttribute('data-state', 'off');
      await button(page).click();
    });
    await test.step('Then the whole app is full screen (not the video element)', async () => {
      await expect.poll(() => fullScreenElement(page)).toBe('HTML');
      await expect(button(page)).toHaveAttribute('data-state', 'on');
    });
    await test.step('When I tap it again, the app leaves full screen', async () => {
      await button(page).click();
      await expect.poll(() => fullScreenElement(page)).toBeNull();
      await expect(button(page)).toHaveAttribute('data-state', 'off');
    });
  });

  test('Scenario: full screen never starts playback, and the PIN prompt still shows in it', async ({ page }) => {
    await test.step('Given the paused video is full screen', async () => {
      await button(page).click();
      await expect.poll(() => fullScreenElement(page)).toBe('HTML');
    });
    await test.step('Then it is still paused', async () => {
      await expectNotPlaying(page);
    });
    await test.step('When I tap Play, the PIN prompt is shown in full screen, and the PIN plays it', async () => {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
      await enterPin(page, PIN);
      await expectPlaying(page);
      expect(await fullScreenElement(page)).toBe('HTML');
    });
  });

  test('Scenario: going back to the library leaves full screen', async ({ page }) => {
    await test.step('Given the video is full screen', async () => {
      await button(page).click();
      await expect.poll(() => fullScreenElement(page)).toBe('HTML');
    });
    await test.step('When I tap Back', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('Then the library is shown, not full screen', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect.poll(() => fullScreenElement(page)).toBeNull();
    });
  });
});
