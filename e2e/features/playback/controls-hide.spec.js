// Feature: Controls get out of the way — while a video plays, Back, Pause and
// the scrub bar fade out after 3 s without input; moving the mouse or tapping
// brings them back. The watch-time clock is never hidden (owner request
// 2026-11-19, M12).
import {
  test, expect, goto, openVideo, startPlaying, expectPlaying, expectNotPlaying, playerState,
} from '../../support.js';

const player = (page) => page.getByTestId('screen-player');
const controls = ['pause-button', 'seek-bar', 'back-button'];

async function expectControls(page, shown) {
  await expect(player(page)).toHaveAttribute('data-controls', shown ? 'shown' : 'hidden');
  for (const id of controls) {
    const el = player(page).getByTestId(id);
    if (shown) await expect(el).toBeVisible();
    else await expect(el).toBeHidden();
  }
}

test.describe('Feature: Controls hide while playing', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await page.clock.install(); // fake timers: fast-forward the 3 s instead of waiting
    await goto(page, '#/library');
    await seedLibrary('medium'); // 60 s
    await openVideo(page, 'medium');
  });

  test('Scenario: while playing, the controls hide after 3 seconds without input', async ({ page }) => {
    await test.step('Given "medium" is playing', async () => {
      await startPlaying(page);
      await expectControls(page, true);
    });
    await test.step('When 3 seconds pass with no mouse movement or tap', async () => {
      await page.clock.fastForward(3500);
    });
    await test.step('Then Back, Pause and the scrub bar are hidden, and it keeps playing', async () => {
      await expectControls(page, false);
      await expectPlaying(page);
    });
  });

  test('Scenario: moving the mouse shows them again, until the next 3 seconds of stillness', async ({ page }) => {
    await test.step('Given "medium" is playing with the controls hidden', async () => {
      await startPlaying(page);
      await page.clock.fastForward(3500);
      await expectControls(page, false);
    });
    await test.step('When I move the mouse', async () => {
      await page.mouse.move(300, 300);
      await page.mouse.move(320, 310);
    });
    await test.step('Then the controls are shown', async () => {
      await expectControls(page, true);
    });
    await test.step('And 3 seconds later they hide again', async () => {
      await page.clock.fastForward(3500);
      await expectControls(page, false);
    });
  });

  test('Scenario: tapping the video shows the controls and does not pause or play', async ({ page }) => {
    await test.step('Given "medium" is playing with the controls hidden', async () => {
      await startPlaying(page);
      await page.clock.fastForward(3500);
      await expectControls(page, false);
    });
    await test.step('When I tap the video', async () => {
      await page.getByTestId('player-video').tap();
    });
    await test.step('Then the controls are shown and it is still playing', async () => {
      await expectControls(page, true);
      await expect(playerState(page)).toHaveAttribute('data-state', 'playing');
      await expectPlaying(page);
    });
  });

  test('Scenario: while paused, the controls stay visible', async ({ page }) => {
    await test.step('Given "medium" is open and paused', async () => {
      await expectNotPlaying(page);
    });
    await test.step('When 3 seconds pass with no input', async () => {
      await page.clock.fastForward(3500);
    });
    await test.step('Then Play, the scrub bar and Back are still shown', async () => {
      await expect(player(page)).toHaveAttribute('data-controls', 'shown');
      for (const id of ['play-button', 'seek-bar', 'back-button']) await expect(player(page).getByTestId(id)).toBeVisible();
    });
  });

  test('Scenario: the watch-time clock stays visible when the controls hide', async ({ page }) => {
    await test.step('Given the watch-time limit is on and a 30-minute session is playing', async () => {
      await page.evaluate(() => {
        localStorage.setItem('features', JSON.stringify({ watchTimeLimit: true }));
        localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 0 }));
      });
      await page.reload();
      await expect(player(page)).toHaveAttribute('data-state', 'paused');
      await startPlaying(page);
    });
    await test.step('When the controls hide', async () => {
      await page.clock.fastForward(3500);
      await expectControls(page, false);
    });
    await test.step('Then time watched, time left and the clock are still shown', async () => {
      for (const id of ['session-time', 'session-remaining', 'clock']) await expect(page.getByTestId(id)).toBeVisible();
    });
  });
});
