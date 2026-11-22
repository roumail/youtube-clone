// Feature: Pause and resume — pausing is free, resuming needs Face ID again.
import { test, expect, goto, openVideo, startPlaying, expectNotPlaying, playerState } from '../../support.js';

test.describe('Feature: Pause and resume', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
    await startPlaying(page);
  });

  test('Scenario: pausing never asks for Face ID @ipad', async ({ page, faceId }) => {
    const before = await faceId.uses();
    await test.step('When I tap pause while "medium" is playing', async () => {
      await page.getByTestId('pause-button').tap();
    });
    await test.step('Then it pauses immediately, with no prompt and no Face ID', async () => {
      expect(await faceId.uses()).toBe(before);
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      await expectNotPlaying(page);
    });
  });

  test('Scenario: resuming after a pause needs Face ID again @ipad', async ({ page, faceId }) => {
    await test.step('Given I paused "medium", and Face ID will fail', async () => {
      await faceId.willFail();
      await page.getByTestId('pause-button').tap();
      await expectNotPlaying(page);
    });
    await test.step('When I tap play', async () => {
      await page.getByTestId('play-button').tap();
    });
    await test.step('Then it waits for Face ID, and nothing plays', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'unlock');
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
    await test.step('When I resume with Face ID', async () => {
      await startPlaying(page);
    });
    await test.step('Then playback continues from that point, not from the start', async () => {
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBeGreaterThanOrEqual(pausedAt);
    });
  });
});
