// Feature: Watch-time limit — an optional parental feature behind a flag, on
// by default and switched in Settings. When on, the
// parent sets a time budget for the session; only playing time counts, across
// all videos; the session survives refreshes and relaunches.
// Built in M6.
import {
  test, expect, goto, openVideo, startPlaying, expectPlaying, expectNotPlaying, playerState,
  setVisibility,
} from '../../support.js';

// Seed the feature flag (normally switched on in Settings, behind Face ID).
async function enableWatchTime(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('features')) localStorage.setItem('features', JSON.stringify({ watchTimeLimit: true }));
  });
}

// These scenarios start from the app's real defaults (the harness otherwise
// starts with the watch-time limit switched off).
test.use({ features: null });

test.describe('Feature: Watch-time limit (optional)', () => {
  test('Scenario: on by default — the first play asks for a budget', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given a fresh install where nobody touched the setting, and "medium" is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
    });
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').click();
    });
    await test.step('Then the budget prompt asks how long they can watch', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
    });
  });

  test('Scenario: switching it off is in Settings, behind Face ID, and sticks', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given settings is unlocked with Face ID', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then "Watch-time limit" is on', async () => {
      await expect(page.getByTestId('feature-toggle-watchTimeLimit')).toBeChecked();
    });
    await test.step('When I switch it off and reload', async () => {
      await page.getByTestId('feature-toggle-watchTimeLimit').uncheck();
      await page.reload();
    });
    await test.step('Then it stays off: playing asks no budget and shows no session time', async () => {
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('features')).watchTimeLimit)).toBe(false);
      await goto(page, '#/library');
      await openVideo(page, 'medium');
      await startPlaying(page);
      await expect(page.getByTestId('budget-prompt')).toBeHidden();
      await expect(page.getByTestId('session-time')).toBeHidden();
    });
  });

  test('Scenario: the first play of a session asks the parent for a budget', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given the feature is on and "medium" is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
    });
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').click();
    });
    await test.step('Then I choose a budget (e.g. 30 minutes) and it plays', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
    });
  });

  test('Scenario: the player shows time watched, time left and the current time', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await page.clock.install({ time: new Date('2026-11-19T18:05:00') });
    await test.step('Given a 30-minute session is playing', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
    });
    await test.step('Then the session bar shows watched, left and the clock', async () => {
      await expect(page.getByTestId('session-time')).toContainText('watched');
      await expect(page.getByTestId('session-remaining')).toContainText('left');
      await expect(page.getByTestId('clock')).toHaveText(/18:0\d/);
    });
  });

  test('Scenario: only playing time counts, not paused time', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await page.clock.install(); // fake timers: fast-forward 5 minutes while paused
    await test.step('Given a session is running and I pause', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
      await page.getByTestId('pause-button').click();
      await expectNotPlaying(page);
    });
    await test.step('Then the time watched does not grow while paused', async () => {
      const used = await page.getByTestId('session-time').getAttribute('data-seconds');
      await page.clock.fastForward('05:00');
      await expect(page.getByTestId('session-time')).toHaveAttribute('data-seconds', used);
    });
  });

  test('Scenario: when the budget runs out, playback stops and needs Face ID', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given a session with 1 second of budget left is playing', async () => {
      await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 1799 })));
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await expectPlaying(page);
    });
    await test.step('Then it pauses with "Time is up"', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'time-up');
      await expectNotPlaying(page);
    });
    await test.step('And play asks for Face ID, which can grant more time', async () => {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
    });
  });

  test('Scenario: when the budget runs out in a playlist, it stops, and Face ID with more time lets it go on', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given a session with 1 second of budget left, and "medium" then "tiny" playing as a playlist', async () => {
      await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 1799 })));
      await page.clock.install();
      await goto(page, '#/library');
      await seedLibrary('medium', 'tiny');
      const medium = page.getByTestId('library-item').filter({ hasText: 'medium' });
      await medium.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
      await page.clock.runFor(600);
      await medium.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, button: 0 });
      await medium.dispatchEvent('click');
      await page.getByTestId('library-item').filter({ hasText: 'tiny' }).tap();
      await page.getByTestId('selection-play').tap();
      await page.getByTestId('play-button').click();
      await expectPlaying(page);
    });
    await test.step('Then "medium" pauses with "Time is up"', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'time-up');
      await expectNotPlaying(page);
    });
    await test.step('When I tap play, pass Face ID and give 30 more minutes', async () => {
      await page.getByTestId('play-button').click();
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
    });
    await test.step('Then at the end of "medium", "tiny" plays next with no Face ID asked', async () => {
      await page.getByTestId('seek-bar').fill('58');
      const tiny = await page.getByTestId('library-item').filter({ hasText: 'tiny' }).getAttribute('data-video-id');
      await expect.poll(() => decodeURIComponent(page.url()).endsWith(`#/player/${tiny}`)).toBe(true);
      await expectPlaying(page);
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
    });
  });

  test('Scenario: one budget across all videos', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given I watched part of "medium" in a session and went back', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium', 'episode-like');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
      await page.getByTestId('pause-button').click();
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('When I play "episode-like"', async () => {
      await openVideo(page, 'episode-like');
      await startPlaying(page);
    });
    await test.step('Then no new budget is asked and the same session time continues', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeHidden();
      await expect.poll(async () => Number(await page.getByTestId('session-time').getAttribute('data-seconds'))).toBeGreaterThan(0);
    });
  });

  test('Scenario: a refresh or relaunch keeps the session and its budget', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given a session with 20 of 30 minutes used', async () => {
      await page.addInitScript(() => {
        if (!localStorage.getItem('watchTime.session')) localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 1200 }));
      });
      await goto(page, '#/library');
      await seedLibrary('medium');
    });
    await test.step('When the app reloads', async () => {
      await page.reload();
    });
    await test.step('Then the session still has 10 minutes left', async () => {
      await openVideo(page, 'medium');
      await expect(page.getByTestId('session-remaining')).toContainText('10:00');
    });
  });

  test('Scenario: the parent can end the session in Settings', async ({ page, setUp }) => {
    await enableWatchTime(page);
    await test.step('Given a session is running and settings is unlocked', async () => {
      await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 600 })));
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
    });
    await test.step('When I tap "End session"', async () => {
      await page.getByTestId('end-session-button').click();
    });
    await test.step('Then the session is gone; the next play asks for a new budget', async () => {
      expect(await page.evaluate(() => localStorage.getItem('watchTime.session'))).toBeNull();
    });
  });
  // Custom budget ("Other…"), owner request 2026-11-19.
  async function openBudgetPrompt(page, seedLibrary) {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
    await page.getByTestId('play-button').click();
    await expect(page.getByTestId('budget-prompt')).toBeVisible();
  }

  test('Scenario: "Other…" sets a budget of my own', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given the feature is on and the budget prompt is open', async () => {
      await openBudgetPrompt(page, seedLibrary);
    });
    await test.step('When I tap "Other…", type 25 and tap Start', async () => {
      await page.getByTestId('budget-option-other').click();
      await page.getByTestId('budget-custom-input').fill('25');
      await page.getByTestId('budget-custom-start').click();
    });
    await test.step('Then it plays with a 25-minute budget, and 25 is remembered', async () => {
      await expectPlaying(page);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('watchTime.session')).budget)).toBe(25 * 60);
      expect(await page.evaluate(() => localStorage.getItem('watchTime.lastCustom'))).toBe('25');
    });
  });

  test('Scenario: a custom budget must be 5 to 180 minutes', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given the feature is on and "Other…" is open in the budget prompt', async () => {
      await openBudgetPrompt(page, seedLibrary);
      await page.getByTestId('budget-option-other').click();
    });
    for (const value of ['3', '200', '']) {
      await test.step(`When I enter "${value}" and tap Start, it is refused and nothing plays`, async () => {
        await page.getByTestId('budget-custom-input').fill(value);
        await page.getByTestId('budget-custom-start').click();
        await expect(page.getByTestId('budget-custom-error')).toContainText('5 to 180');
        await expect(page.getByTestId('budget-prompt')).toBeVisible();
        await expectNotPlaying(page);
        expect(await page.evaluate(() => localStorage.getItem('watchTime.session'))).toBeNull();
      });
    }
  });

  test('Scenario: the last custom budget is offered next time', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await page.addInitScript(() => localStorage.setItem('watchTime.lastCustom', '25'));
    await test.step('Given a custom budget of 25 minutes was used before, and the budget prompt is open', async () => {
      await openBudgetPrompt(page, seedLibrary);
    });
    await test.step('When I tap "Other…"', async () => {
      await page.getByTestId('budget-option-other').click();
    });
    await test.step('Then the field already says 25', async () => {
      await expect(page.getByTestId('budget-custom-input')).toHaveValue('25');
    });
  });

  test('Scenario: switching it back on in Settings takes effect at once, without a reload', async ({ page, setUp, seedLibrary }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('features')) localStorage.setItem('features', JSON.stringify({ watchTimeLimit: false }));
    });
    await test.step('Given the limit was switched off and settings is unlocked', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('feature-toggle-watchTimeLimit')).not.toBeChecked();
    });
    await test.step('When I switch it on and open "medium" without reloading', async () => {
      await page.getByTestId('feature-toggle-watchTimeLimit').check();
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await openVideo(page, 'medium');
    });
    await test.step('Then play with Face ID asks for a budget', async () => {
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
    });
  });

  test('Scenario: cancelling the budget prompt leaves the video paused', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given the budget prompt is open after play and Face ID', async () => {
      await openBudgetPrompt(page, seedLibrary);
    });
    await test.step('When I tap Cancel', async () => {
      await page.getByTestId('budget-cancel').click();
    });
    await test.step('Then the prompt closes, nothing plays and no session starts', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeHidden();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
      expect(await page.evaluate(() => localStorage.getItem('watchTime.session'))).toBeNull();
    });
  });

  test('Scenario: the arrow keys in the budget\'s minutes field change the minutes, not the video', async ({ page, setUp, seedLibrary }) => {
    const position = () => page.getByTestId('player-video').evaluate((v) => v.currentTime);
    await test.step('Given "medium" is open at 0:30 and the budget prompt\'s own minutes field is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('seek-bar').fill('30');
      await page.getByTestId('play-button').click();
      await page.getByTestId('budget-option-other').click();
      await page.getByTestId('budget-custom-input').focus();
    });
    await test.step('When I press → and ← in the minutes field', async () => {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
    });
    await test.step('Then the video is still at 0:30', async () => {
      await expect.poll(position).toBeCloseTo(30, 0);
    });
  });

  test('Scenario: after leaving the app with the budget prompt open, choosing a budget does not start playback', async ({ page, setUp, seedLibrary, faceId }) => {
    await test.step('Given I tapped play on "medium", passed Face ID, and the budget prompt is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
    });
    await test.step('When the app goes to the background and comes back', async () => {
      await setVisibility(page, 'hidden');
      await setVisibility(page, 'visible');
    });
    await test.step('And I choose 30 minutes', async () => {
      await page.getByTestId('budget-option-30').click();
    });
    await test.step('Then nothing plays: the video is paused and play asks for Face ID again', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
      const before = await faceId.uses();
      await page.getByTestId('play-button').click();
      await expect.poll(() => faceId.uses()).toBe(before + 1);
    });
  });

  // The clock next to the session times: a shortcut to a new time limit,
  // without going back to Settings.
  async function playWithTimeLeft(page, seedLibrary) {
    await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 1500 })));
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
    await startPlaying(page);
  }
  const session = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('watchTime.session')));

  test('Scenario: the clock sets a new time limit after Face ID, and the video goes on @ipad', async ({ page, setUp, seedLibrary, faceId }) => {
    await enableWatchTime(page);
    await test.step('Given "medium" is playing with 5 minutes of a 30-minute session left', async () => {
      await playWithTimeLeft(page, seedLibrary);
    });
    await test.step('When I tap the clock and pass Face ID', async () => {
      const before = await faceId.uses();
      await page.getByTestId('timer-button').click();
      await expect.poll(() => faceId.uses()).toBe(before + 1);
    });
    await test.step('Then the video is paused and the budget prompt asks how long they can watch', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
      await expectNotPlaying(page);
    });
    await test.step('When I choose 45 minutes', async () => {
      await page.getByTestId('budget-option-45').click();
    });
    await test.step('Then the video goes on with a fresh 45 minutes', async () => {
      await expectPlaying(page);
      await expect(page.getByTestId('session-remaining')).toHaveText(/^4[45]:\d\d left$/);
      expect((await session(page)).budget).toBe(45 * 60);
    });
  });

  test('Scenario: cancelling after the clock keeps the time limit it had, paused', async ({ page, setUp, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given "medium" is playing with 5 minutes of a 30-minute session left', async () => {
      await playWithTimeLeft(page, seedLibrary);
    });
    await test.step('When I tap the clock, pass Face ID and tap Cancel', async () => {
      await page.getByTestId('timer-button').click();
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
      await page.getByTestId('budget-cancel').click();
    });
    await test.step('Then the video is paused and the session is the one it had', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeHidden();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
      const s = await session(page);
      expect(s.budget).toBe(1800);
      expect(s.used).toBeGreaterThanOrEqual(1500);
    });
  });
});
