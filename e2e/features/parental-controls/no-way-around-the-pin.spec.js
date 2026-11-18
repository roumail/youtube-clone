// Feature: No way around the PIN — backgrounding pauses; OS "play" commands and
// script-initiated play never resume playback.
import {
  test, expect, goto, openVideo, startPlaying, expectNotPlaying, playerState,
  setVisibility, mediaSessionAction,
} from '../../support.js';

test.describe('Feature: No way around the PIN', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
  });

  test.fixme('Scenario: leaving the app pauses, and coming back needs the PIN', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    await test.step('When the app goes to the background', async () => {
      await setVisibility(page, 'hidden');
    });
    await test.step('Then the video pauses', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
    });
    await test.step('When the app comes back and I tap play', async () => {
      await setVisibility(page, 'visible');
      await page.getByTestId('play-button').click();
    });
    await test.step('Then the PIN is required', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
    });
  });

  test.fixme('Scenario: headphone / lock-screen "play" does not resume', async ({ page }) => {
    await test.step('Given "medium" was playing and I paused it', async () => {
      await startPlaying(page);
      await page.getByTestId('pause-button').click();
      await expectNotPlaying(page);
    });
    await test.step('When the OS sends a Media Session "play"', async () => {
      await mediaSessionAction(page, 'play');
    });
    await test.step('Then the video stays paused and the PIN prompt is shown', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
      await expectNotPlaying(page);
    });
  });

  test.fixme('Scenario: play started outside the PIN flow is stopped at once', async ({ page }) => {
    await test.step('When something calls video.play() directly', async () => {
      await page.getByTestId('player-video').evaluate((v) => v.play().catch(() => {}));
    });
    await test.step('Then the app pauses it again', async () => {
      await expectNotPlaying(page);
      await expect(playerState(page)).not.toHaveAttribute('data-state', 'playing');
    });
  });
});
