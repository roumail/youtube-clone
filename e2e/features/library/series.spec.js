// Feature: Series — the library shows one tile per series; tapping it lists
// the episodes in order. Titles "Series - SxxEyy - Episode".
import { test, expect, goto, startPlaying, expectNotPlaying } from '../../support.js';

const EPISODES = ['Show - S01E10 - Tenth', 'Show - S01E01 - First', 'Show - S01E02 - Second'];

test.describe('Feature: Series', () => {
  test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary(...EPISODES, 'tiny');
  });

  test('Scenario: the library shows one tile per series, next to standalone videos', async ({ page }) => {
    await test.step('Then "Show" is one tile saying it has 3 episodes', async () => {
      const tile = page.getByTestId('series-item').filter({ hasText: 'Show' });
      await expect(tile).toHaveCount(1);
      await expect(tile).toContainText('3 episodes');
    });
    await test.step('And no episode appears as its own tile; "tiny" still does', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'S01E' })).toHaveCount(0);
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test('Scenario: tapping a series lists its episodes in order', async ({ page }) => {
    await test.step('When I tap the "Show" tile', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).click();
    });
    await test.step('Then the series screen lists E01, E02, E10 in that order, in the same app', async () => {
      await expect(page).toHaveURL(/#\/series\//);
      await expect(page.getByTestId('screen-series')).toBeVisible();
      await expect(page.getByTestId('episode-item')).toHaveText([/S01E01.*First/, /S01E02.*Second/, /S01E10.*Tenth/]);
    });
  });

  test('Scenario: an episode opens paused, and back returns to the series', async ({ page }) => {
    await test.step('Given I opened the "Show" series and tapped E02', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).click();
      await page.getByTestId('episode-item').filter({ hasText: 'S01E02' }).click();
    });
    await test.step('Then the player shows it paused (play still needs the PIN)', async () => {
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
    });
    await test.step('When I tap back', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
    });
    await test.step('Then I am back on the "Show" episode list', async () => {
      await expect(page.getByTestId('screen-series')).toBeVisible();
    });
  });

  test('Scenario: the end of an episode never starts the next one', async ({ page }) => {
    await test.step('Given E01 of "Show" (3 s) is playing', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).click();
      await page.getByTestId('episode-item').filter({ hasText: 'S01E01' }).click();
      await startPlaying(page);
    });
    await test.step('Then at its end it stops; E02 is not loaded', async () => {
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'ended');
      expect(decodeURIComponent(page.url())).not.toContain('S01E02');
    });
  });
});
