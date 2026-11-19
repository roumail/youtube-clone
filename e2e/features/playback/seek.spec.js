// Feature: Seek — a scrub bar (elapsed / total) and ← / → to jump 10 s.
// The child may seek freely: seeking never starts playback, so it can't get
// around the PIN (owner decision 2026-11-19). Drafted for review (test.fixme).
import {
  test, expect, goto, openVideo, startPlaying, expectPlaying, expectNotPlaying, playerState,
} from '../../support.js';

const position = (page) => page.getByTestId('player-video').evaluate((v) => v.currentTime);

test.describe('Feature: Seek', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium'); // 60 s
    await openVideo(page, 'medium');
  });

  test.fixme('Scenario: the player shows a scrub bar with elapsed and total time', async ({ page }) => {
    await test.step('Then the bar is at the start and shows 00:00 / 01:00', async () => {
      await expect(page.getByTestId('seek-bar')).toBeVisible();
      await expect(page.getByTestId('time-elapsed')).toHaveText('00:00');
      await expect(page.getByTestId('time-total')).toHaveText('01:00');
    });
  });

  test.fixme('Scenario: dragging the bar while paused jumps there and stays paused, with no PIN', async ({ page }) => {
    await test.step('When I drag the bar to 0:30', async () => {
      await page.getByTestId('seek-bar').fill('30');
    });
    await test.step('Then the video is at 0:30, still paused, and no PIN was asked', async () => {
      await expect.poll(() => position(page)).toBeCloseTo(30, 0);
      await expect(page.getByTestId('time-elapsed')).toHaveText('00:30');
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expectNotPlaying(page);
    });
  });

  test.fixme('Scenario: seeking while playing keeps playing from the new point', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    await test.step('When I drag the bar to 0:40', async () => {
      await page.getByTestId('seek-bar').fill('40');
    });
    await test.step('Then it plays on from about 0:40', async () => {
      await expect.poll(() => position(page)).toBeGreaterThanOrEqual(40);
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: the arrow keys jump 10 seconds back and forward', async ({ page }) => {
    await test.step('When I press → twice while paused', async () => {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
    });
    await test.step('Then the video is at 0:20, still paused', async () => {
      await expect.poll(() => position(page)).toBeCloseTo(20, 0);
      await expectNotPlaying(page);
    });
    await test.step('When I press ←', async () => {
      await page.keyboard.press('ArrowLeft');
    });
    await test.step('Then it is at 0:10', async () => {
      await expect.poll(() => position(page)).toBeCloseTo(10, 0);
    });
  });

  test.fixme('Scenario: the elapsed time follows playback', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    await test.step('Then the elapsed time moves past 00:00', async () => {
      await expect(page.getByTestId('time-elapsed')).not.toHaveText('00:00', { timeout: 5000 });
    });
  });
});
