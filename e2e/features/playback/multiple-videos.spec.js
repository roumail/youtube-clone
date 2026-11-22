// Feature: Several videos — one plays at a time; switching never auto-plays.
import {
  test, expect, goto, openVideo, startPlaying, expectNotPlaying, playerState, slowPlayer,
} from '../../support.js';

test.describe('Feature: Several videos', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
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

  test('Scenario: opening another video after watching one starts paused and needs Face ID', async ({ page, faceId }) => {
    await test.step('Given I watched "medium" and went back', async () => {
      await openVideo(page, 'medium');
      await startPlaying(page);
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('When I open "episode-like"', async () => {
      await openVideo(page, 'episode-like');
    });
    await test.step('Then it is paused, and play asks for Face ID', async () => {
      await expectNotPlaying(page);
      const before = await faceId.uses();
      await page.getByTestId('play-button').click();
      await expect.poll(() => faceId.uses()).toBe(before + 1);
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

  test('Scenario: going back while a video is still opening keeps the library, even when it finishes opening', async ({ page }) => {
    const player = await slowPlayer(page);
    await test.step('Given opening a video is slow (a big film on the iPad)', async () => {
      await player.hold('load');
    });
    await test.step('When I open "medium" and go back before it has opened', async () => {
      await page.getByTestId('library-item').filter({ hasText: 'medium' }).click();
      await expect(playerState(page)).toHaveAttribute('data-state', 'loading');
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('And "medium" finishes opening after that', async () => {
      await player.release('load');
    });
    await test.step('Then the library is still shown, and "tiny" opens as usual, paused at the start', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await openVideo(page, 'tiny');
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBe(0);
    });
  });

  test('Scenario: opening another video while the previous one is still closing opens the new one', async ({ page }) => {
    const player = await slowPlayer(page);
    await test.step('Given "tiny" is open and closing a video is slow', async () => {
      await openVideo(page, 'tiny');
      await player.hold('unload');
    });
    await test.step('When I go back and open "medium" before "tiny" has closed', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await page.getByTestId('library-item').filter({ hasText: 'medium' }).click();
      await expect(playerState(page)).toHaveAttribute('data-state', 'loading');
    });
    await test.step('And "tiny" finishes closing', async () => {
      await player.release('unload');
    });
    await test.step('Then "medium" opens, paused at the start', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('time-total')).toHaveText('01:00');
      await expectNotPlaying(page);
    });
  });

  test('Scenario: going back again before the previous video has closed leaves the library', async ({ page }) => {
    const player = await slowPlayer(page);
    await test.step('Given "tiny" is open and closing a video is slow', async () => {
      await openVideo(page, 'tiny');
      await player.hold('unload');
    });
    await test.step('When I go back, open "medium" and go back again, all before "tiny" has closed', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await page.getByTestId('library-item').filter({ hasText: 'medium' }).click();
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('And the closing finishes', async () => {
      await player.release('unload');
    });
    await test.step('Then the library is shown, and "medium" opens as usual', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await openVideo(page, 'medium');
    });
  });
});
