// Feature: Watch-time limit — an OPTIONAL parental feature behind a flag
// (DESIGN.md §5, "Optional parental features"). Off by default. When on, the
// parent sets a time budget for the session; only playing time counts, across
// all videos; the session survives refreshes and relaunches.
// Drafted for review; not built yet (test.fixme).
import { test, expect, goto, enterPin, openVideo, startPlaying, expectPlaying, expectNotPlaying, playerState, PIN } from '../../support.js';

// Seed the feature flag (normally switched on in Settings, behind the PIN).
async function enableWatchTime(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('features')) localStorage.setItem('features', JSON.stringify({ watchTimeLimit: true }));
  });
}

test.describe('Feature: Watch-time limit (optional)', () => {
  test.fixme('Scenario: off by default — no budget prompt and no session clock', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given the feature has never been switched on and "medium" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
    });
    await test.step('When I play it with the PIN', async () => {
      await startPlaying(page);
    });
    await test.step('Then no budget was asked and no session time is shown', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeHidden();
      await expect(page.getByTestId('session-time')).toBeHidden();
    });
  });

  test.fixme('Scenario: switching the feature on or off happens in Settings, behind the PIN', async ({ page, pinSet }) => {
    await test.step('Given settings is unlocked with the PIN', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
    });
    await test.step('When I switch "Watch-time limit" on', async () => {
      await page.getByTestId('feature-toggle-watchTimeLimit').check();
    });
    await test.step('Then it stays on after a reload', async () => {
      await page.reload();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('features')).watchTimeLimit)).toBe(true);
    });
  });

  test.fixme('Scenario: the first play of a session asks the parent for a budget', async ({ page, pinSet, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given the feature is on and "medium" is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
    });
    await test.step('When I tap play and enter the PIN', async () => {
      await page.getByTestId('play-button').click();
      await enterPin(page, PIN);
    });
    await test.step('Then I choose a budget (e.g. 30 minutes) and it plays', async () => {
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: the player shows time watched, time left and the current time', async ({ page, pinSet, seedLibrary }) => {
    await enableWatchTime(page);
    await page.clock.install({ time: new Date('2026-11-19T18:05:00') });
    await test.step('Given a 30-minute session is playing', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await enterPin(page, PIN);
      await page.getByTestId('budget-option-30').click();
      await expectPlaying(page);
    });
    await test.step('Then the session bar shows watched, left and the clock', async () => {
      await expect(page.getByTestId('session-time')).toContainText('watched');
      await expect(page.getByTestId('session-remaining')).toContainText('left');
      await expect(page.getByTestId('clock')).toHaveText(/18:0\d/);
    });
  });

  test.fixme('Scenario: only playing time counts, not paused time', async ({ page, pinSet, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given a session is running and I pause', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await enterPin(page, PIN);
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

  test.fixme('Scenario: when the budget runs out, playback stops and needs the PIN', async ({ page, pinSet, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given a session with 1 second of budget left is playing', async () => {
      await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 1799 })));
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await enterPin(page, PIN);
      await expectPlaying(page);
    });
    await test.step('Then it pauses with "Time is up"', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'time-up');
      await expectNotPlaying(page);
    });
    await test.step('And play asks for the PIN, which can grant more time', async () => {
      await page.getByTestId('play-button').click();
      await enterPin(page, PIN);
      await expect(page.getByTestId('budget-prompt')).toBeVisible();
    });
  });

  test.fixme('Scenario: one budget across all videos', async ({ page, pinSet, seedLibrary }) => {
    await enableWatchTime(page);
    await test.step('Given I watched part of "medium" in a session and went back', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium', 'episode-like');
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').click();
      await enterPin(page, PIN);
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
      expect(Number(await page.getByTestId('session-time').getAttribute('data-seconds'))).toBeGreaterThan(0);
    });
  });

  test.fixme('Scenario: a refresh or relaunch keeps the session and its budget', async ({ page, pinSet, seedLibrary }) => {
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

  test.fixme('Scenario: the parent can end the session in Settings', async ({ page, pinSet }) => {
    await enableWatchTime(page);
    await test.step('Given a session is running and settings is unlocked', async () => {
      await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 600 })));
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
    });
    await test.step('When I tap "End session"', async () => {
      await page.getByTestId('end-session-button').click();
    });
    await test.step('Then the session is gone; the next play asks for a new budget', async () => {
      expect(await page.evaluate(() => localStorage.getItem('watchTime.session'))).toBeNull();
    });
  });
});
