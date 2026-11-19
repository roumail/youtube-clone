// Feature: No way around the PIN — backgrounding pauses; OS "play" commands and
// script-initiated play never resume playback.
import {
  test, expect, goto, openVideo, startPlaying, expectPlaying, expectNotPlaying, playerState,
  setVisibility, mediaSessionAction,
} from '../../support.js';

test.describe('Feature: No way around the PIN', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
  });

  test('Scenario: leaving the app pauses, and coming back needs the PIN', async ({ page }) => {
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

  test('Scenario: headphone / lock-screen "play" does not resume', async ({ page }) => {
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

  test('Scenario: play started outside the PIN flow is stopped at once', async ({ page }) => {
    await test.step('When something calls video.play() directly', async () => {
      await page.getByTestId('player-video').evaluate((v) => v.play().catch(() => {}));
    });
    await test.step('Then the app pauses it again', async () => {
      await expectNotPlaying(page);
      await expect(playerState(page)).not.toHaveAttribute('data-state', 'playing');
    });
  });

  test('Scenario: headphone / lock-screen "play" while playing changes nothing', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    await test.step('When the OS sends "play"', async () => {
      await mediaSessionAction(page, 'play');
    });
    await test.step('Then it keeps playing and no PIN is asked', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expectPlaying(page);
    });
  });

  test('Scenario: headphone / lock-screen "play" while the PIN prompt is open changes nothing', async ({ page }) => {
    await test.step('Given I tapped play and the PIN prompt is open', async () => {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
    });
    await test.step('When the OS sends "play"', async () => {
      await mediaSessionAction(page, 'play');
    });
    await test.step('Then the same prompt stays open and nothing plays', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
      await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
      await expectNotPlaying(page);
    });
  });

  test('Scenario: headphone / lock-screen "play" on the library does nothing', async ({ page }) => {
    await test.step('Given I went back to the library', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await expect(page.getByTestId('screen-library')).toBeVisible();
    });
    await test.step('When the OS sends "play"', async () => {
      await mediaSessionAction(page, 'play');
    });
    await test.step('Then the library stays, with no PIN prompt', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
    });
  });

  test('Scenario: leaving the app while the play PIN prompt is open closes it', async ({ page }) => {
    await test.step('Given I tapped play and the PIN prompt is open', async () => {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
    });
    await test.step('When the app goes to the background and comes back', async () => {
      await setVisibility(page, 'hidden');
      await setVisibility(page, 'visible');
    });
    await test.step('Then the prompt is gone and the video is paused', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    });
    await test.step('And play asks for the PIN again', async () => {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    });
  });
});
