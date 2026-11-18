// Rule: no route around the PIN. Backgrounding pauses; OS "play" commands and
// script-initiated play do not resume playback.
import {
  test, expect, goto, enterPin, openVideo, expectPlaying, expectNotPlaying, playerState,
  setVisibility, mediaSessionAction, PIN,
} from './support.js';

test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
  await goto(page, '#/library');
  await seedLibrary('medium');
  await openVideo(page, 'medium');
});

async function startPlaying(page) {
  await page.getByTestId('play-button').click();
  await enterPin(page, PIN);
  await expectPlaying(page);
}

test.fixme('leaving the app pauses, and coming back needs the PIN', async ({ page }) => {
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

test.fixme('headphone / lock-screen "play" does not resume', async ({ page }) => {
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

test.fixme('play started outside the PIN flow is immediately stopped', async ({ page }) => {
  await test.step('Given "medium" is open and paused', async () => {
    await expectNotPlaying(page);
  });
  await test.step('When something calls video.play() directly', async () => {
    await page.getByTestId('player-video').evaluate((v) => v.play().catch(() => {}));
  });
  await test.step('Then the app pauses it again', async () => {
    await expectNotPlaying(page);
    await expect(playerState(page)).not.toHaveAttribute('data-state', 'playing');
  });
});
