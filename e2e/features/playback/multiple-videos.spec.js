// Feature: Several videos — one plays at a time; switching never auto-plays.
import {
  test, expect, goto, openVideo, startPlaying, expectNotPlaying, playerState,
} from '../../support.js';

test.describe('Feature: Several videos', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('tiny', 'medium', 'episode-like');
  });

  test('Scenario: going back to the library stops the playing video', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await openVideo(page, 'medium');
      await startPlaying(page);
    });
    await test.step('When I go back to the library', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('Then the library shows and no video is playing anywhere', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      const anyPlaying = await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused));
      expect(anyPlaying).toBe(false);
    });
  });

  test('Scenario: opening another video after watching one starts paused and needs the PIN', async ({ page }) => {
    await test.step('Given I watched "medium" and went back', async () => {
      await openVideo(page, 'medium');
      await startPlaying(page);
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('When I open "episode-like"', async () => {
      await openVideo(page, 'episode-like');
    });
    await test.step('Then it is paused, and play asks for the PIN', async () => {
      await expectNotPlaying(page);
      await page.getByTestId('play-button').click();
      await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
    });
  });

  test('Scenario: reopening a video starts it from the beginning, paused', async ({ page }) => {
    await test.step('Given I watched part of "medium" and went back', async () => {
      await openVideo(page, 'medium');
      await startPlaying(page);
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('When I open "medium" again', async () => {
      await openVideo(page, 'medium');
    });
    await test.step('Then it is paused at 0:00', async () => {
      await expectNotPlaying(page);
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBe(0);
    });
  });
});
