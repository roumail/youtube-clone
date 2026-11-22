// Feature: Seek — a scrub bar (elapsed / total) and ← / → to jump 10 s.
// The child may seek freely: seeking never starts playback, so it can't get
// around unlocking (owner decision 2026-11-19). Built in M8.
import {
  test, expect, goto, openVideo, startPlaying, expectPlaying, expectNotPlaying, playerState,
  slowPlayer,
} from '../../support.js';

const position = (page) => page.getByTestId('player-video').evaluate((v) => v.currentTime);

test.describe('Feature: Seek', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium'); // 60 s
    await openVideo(page, 'medium');
  });

  test('Scenario: the player shows a scrub bar with elapsed and total time', async ({ page }) => {
    await test.step('Then the bar is at the start and shows 00:00 / 01:00', async () => {
      await expect(page.getByTestId('seek-bar')).toBeVisible();
      await expect(page.getByTestId('time-elapsed')).toHaveText('00:00');
      await expect(page.getByTestId('time-total')).toHaveText('01:00');
    });
  });

  test('Scenario: dragging the bar while paused jumps there and stays paused, with no Face ID', async ({ page }) => {
    await test.step('When I drag the bar to 0:30', async () => {
      await page.getByTestId('seek-bar').fill('30');
    });
    await test.step('Then the video is at 0:30, still paused, and no unlocking was asked', async () => {
      await expect.poll(() => position(page)).toBeCloseTo(30, 0);
      await expect(page.getByTestId('time-elapsed')).toHaveText('00:30');
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      await expectNotPlaying(page);
    });
  });

  test('Scenario: seeking while playing keeps playing from the new point', async ({ page }) => {
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

  test('Scenario: the arrow keys jump 10 seconds back and forward', async ({ page }) => {
    await test.step('Given the player knows the video is 01:00 long', async () => {
      await expect(page.getByTestId('time-total')).toHaveText('01:00');
    });
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

  test('Scenario: the elapsed time follows playback', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    await test.step('Then the elapsed time moves past 00:00', async () => {
      await expect(page.getByTestId('time-elapsed')).not.toHaveText('00:00', { timeout: 5000 });
    });
  });

  test('Scenario: a video an hour or longer shows hours in its times', async ({ page, seedLibrary }) => {
    await test.step('Given "long" (1 hour 5 seconds) is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('long');
      await openVideo(page, 'long');
    });
    await test.step('Then its total time reads "1:00:05"', async () => {
      await expect(page.getByTestId('time-total')).toHaveText('1:00:05');
    });
    await test.step('When I drag the bar to one hour', async () => {
      await page.getByTestId('seek-bar').fill('3600');
    });
    await test.step('Then the elapsed time reads "1:00:00"', async () => {
      await expect(page.getByTestId('time-elapsed')).toHaveText('1:00:00');
    });
  });

  test('Scenario: seeking back from the end makes the video paused again', async ({ page }) => {
    await test.step('Given "medium" has played to its end', async () => {
      await page.getByTestId('seek-bar').fill('58');
      await startPlaying(page);
      await expect(playerState(page)).toHaveAttribute('data-state', 'ended');
    });
    await test.step('When I drag the bar back to 0:30', async () => {
      await page.getByTestId('seek-bar').fill('30');
    });
    await test.step('Then it is paused at 0:30, with the play button showing', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('time-elapsed')).toHaveText('00:30');
      await expect(page.getByTestId('play-button')).toBeVisible();
      await expectNotPlaying(page);
    });
  });

  test('Scenario: with the scrub bar focused, the arrow keys still jump 10 seconds', async ({ page }) => {
    await test.step('Given the scrub bar has the keyboard focus', async () => {
      await expect(page.getByTestId('time-total')).toHaveText('01:00');
      await page.getByTestId('seek-bar').focus();
    });
    await test.step('When I press →', async () => {
      await page.keyboard.press('ArrowRight');
    });
    await test.step('Then the video is at 0:10, not 0:01', async () => {
      await expect.poll(() => position(page)).toBeCloseTo(10, 0);
    });
  });

  test('Scenario: while I hold the scrub bar, the time shows where I hold it, not playback', async ({ page }) => {
    const bar = page.getByTestId('seek-bar');
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    let held;
    await test.step('When I press the middle of the bar and keep holding it', async () => {
      const box = await bar.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      held = Number(await bar.inputValue());
    });
    await test.step('Then, while the video plays on, the bar and the time stay where I hold them', async () => {
      const t0 = await position(page);
      await expect.poll(() => position(page)).toBeGreaterThan(t0 + 1);
      expect(Number(await bar.inputValue())).toBe(held);
      await expect(page.getByTestId('time-elapsed')).toHaveText(`00:${String(held).padStart(2, '0')}`);
    });
    await test.step('When I let go', async () => {
      await page.mouse.up();
    });
    await test.step('Then it keeps playing from where I held it', async () => {
      await expectPlaying(page);
      expect(await position(page)).toBeGreaterThanOrEqual(held);
    });
  });

  test('Scenario: the arrow keys while a video is still opening do nothing', async ({ page }) => {
    const player = await slowPlayer(page);
    await test.step('Given "medium" is opening slowly', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await player.hold('load');
      await page.getByTestId('library-item').filter({ hasText: 'medium' }).click();
      await expect(playerState(page)).toHaveAttribute('data-state', 'loading');
    });
    await test.step('When I press → while it opens', async () => {
      await page.keyboard.press('ArrowRight');
    });
    await test.step('Then, once it has opened, it is paused at the start', async () => {
      await player.release('load');
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      expect(await position(page)).toBe(0);
    });
  });

  // WebKit (iPad, iPhone) sends no change event when a finger taps the bar.
  test('Scenario: after a finger taps the scrub bar, the time keeps following playback @ipad', async ({ page }) => {
    const bar = page.getByTestId('seek-bar');
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
    });
    let tapped;
    await test.step('When I tap the middle of the bar with a finger', async () => {
      const box = await bar.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      tapped = Number(await bar.inputValue());
    });
    await test.step('Then the video jumps there', async () => {
      await expect.poll(() => position(page)).toBeGreaterThanOrEqual(tapped);
    });
    await test.step('And the bar and the time on screen keep following playback', async () => {
      await expect.poll(async () => Number(await bar.inputValue())).toBeGreaterThan(tapped);
      await expect(page.getByTestId('time-elapsed')).not.toHaveText(`00:${String(tapped).padStart(2, '0')}`);
    });
  });
});
