// Feature: Pause and resume — pausing is free, resuming needs the PIN again.
import {
  test, expect, goto, openVideo, startPlaying, expectNotPlaying, playerState,
} from '../../support.js';

test.describe('Feature: Pause and resume', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
    await startPlaying(page);
  });

  test('Scenario: pausing never shows a PIN window @ipad', async ({ page }) => {
    await test.step('When I tap pause while "medium" is playing', async () => {
      await page.getByTestId('pause-button').tap();
    });
    await test.step('Then it pauses immediately, with no PIN prompt', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expectNotPlaying(page);
    });
  });

  test('Scenario: resuming after a pause asks for the PIN again @ipad', async ({ page }) => {
    await test.step('Given I paused "medium"', async () => {
      await page.getByTestId('pause-button').tap();
      await expectNotPlaying(page);
    });
    await test.step('When I tap play', async () => {
      await page.getByTestId('play-button').tap();
    });
    await test.step('Then the PIN is required and nothing plays yet', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
      await expectNotPlaying(page);
    });
  });

  test('Scenario: resuming continues from where it was paused @ipad', async ({ page }) => {
    let pausedAt;
    await test.step('Given I paused "medium" partway through', async () => {
      await page.getByTestId('pause-button').tap();
      await expectNotPlaying(page);
      pausedAt = await page.getByTestId('player-video').evaluate((v) => v.currentTime);
      expect(pausedAt).toBeGreaterThan(0);
    });
    await test.step('When I resume with the PIN', async () => {
      await startPlaying(page);
    });
    await test.step('Then playback continues from that point, not from the start', async () => {
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBeGreaterThanOrEqual(pausedAt);
    });
  });
});
