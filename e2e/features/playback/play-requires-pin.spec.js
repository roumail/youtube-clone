// Feature: Playing needs the PIN — every time playback starts.
import {
  test, expect, goto, enterPin, openVideo, expectPlaying, expectNotPlaying, playerState, PIN, WRONG_PIN,
} from '../../support.js';

test.describe('Feature: Playing needs the PIN', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
  });

  test.fixme('Scenario: play asks for the PIN, and the correct PIN starts playback', async ({ page }) => {
    await test.step('When I tap play', async () => {
      await page.getByTestId('play-button').click();
    });
    await test.step('Then the PIN prompt is shown and nothing plays yet', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
      await expectNotPlaying(page);
    });
    await test.step('When I enter the correct PIN', async () => {
      await enterPin(page, PIN);
    });
    await test.step('Then the video plays', async () => {
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: a wrong PIN does not start playback', async ({ page }) => {
    await test.step('When I tap play and enter a wrong PIN', async () => {
      await page.getByTestId('play-button').click();
      await enterPin(page, WRONG_PIN);
    });
    await test.step('Then the prompt says it is wrong and nothing plays', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
      await expectNotPlaying(page);
    });
  });

  test.fixme('Scenario: cancelling the PIN prompt leaves the video paused', async ({ page }) => {
    await test.step('When I tap play and then cancel the PIN prompt', async () => {
      await page.getByTestId('play-button').click();
      await page.getByTestId('pin-cancel').click();
    });
    await test.step('Then the prompt closes and the video is still paused', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
    });
  });
});
