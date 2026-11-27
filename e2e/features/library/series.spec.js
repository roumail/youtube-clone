// Feature: Series — the library shows one tile per series; tapping it lists
// the episodes in order. Titles "Series - SxxEyy - Episode". Videos without a
// season and episode join a series by the name before their first " - "
// ("Music - Song"), once at least two videos share it; they are listed A–Z
// after the numbered episodes. An episode played alone never starts the next
// one; a playlist does (playlist.spec.js).
import { test, expect, goto, startPlaying, expectNotPlaying } from '../../support.js';

const EPISODES = ['Show - S01E10 - Tenth', 'Show - S01E01 - First', 'Show - S01E02 - Second'];

test.describe('Feature: Series', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
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
    await test.step('Then the player shows it paused (play still needs Face ID)', async () => {
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

  test('Scenario: an episode without a title is listed by its number alone', async ({ page, seedLibrary }) => {
    await test.step('Given "Show - S01E03" (no episode title) is stored too', async () => {
      await seedLibrary('Show - S01E03');
    });
    await test.step('When I tap the "Show" tile', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).click();
    });
    await test.step('Then its episodes read "S01E01 · First", "S01E02 · Second", "S01E03", "S01E10 · Tenth"', async () => {
      await expect(page.getByTestId('episode-item')).toHaveText(['S01E01 · First', 'S01E02 · Second', 'S01E03', 'S01E10 · Tenth']);
    });
  });

  test('Scenario: videos sharing the name before " - " are one tile, listed A–Z by the rest', async ({ page, seedLibrary }) => {
    await test.step('Given "Music - Ludovico Einaudi - Tiny Desk" and "Music - Coke Studio - Piya Ghar Aaya" are stored too', async () => {
      await seedLibrary('Music - Ludovico Einaudi - Tiny Desk', 'Music - Coke Studio - Piya Ghar Aaya');
    });
    await test.step('Then "Music" is one tile saying it has 2 videos, and neither is its own tile', async () => {
      const tile = page.getByTestId('series-item').filter({ hasText: 'Music' });
      await expect(tile).toHaveCount(1);
      await expect(tile).toContainText('2 videos');
      await expect(page.getByTestId('library-item').filter({ hasText: 'Music' })).toHaveCount(0);
    });
    await test.step('When I tap the "Music" tile', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Music' }).click();
    });
    await test.step('Then it lists "Coke Studio - Piya Ghar Aaya", then "Ludovico Einaudi - Tiny Desk"', async () => {
      await expect(page.getByTestId('episode-item')).toHaveText(['Coke Studio - Piya Ghar Aaya', 'Ludovico Einaudi - Tiny Desk']);
    });
  });

  test('Scenario: a name before " - " that only one video has stays a standalone video', async ({ page, seedLibrary }) => {
    await test.step('Given "Lone - Thing" is stored too', async () => {
      await seedLibrary('Lone - Thing');
    });
    await test.step('Then it is its own tile under its full title, and there is no "Lone" series', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'Lone - Thing' })).toBeVisible();
      await expect(page.getByTestId('series-item').filter({ hasText: 'Lone' })).toHaveCount(0);
    });
  });

  test('Scenario: a video named "Show - …" without a number joins the series "Show", after its episodes', async ({ page, seedLibrary }) => {
    await test.step('Given "Show - Bonus" is stored too', async () => {
      await seedLibrary('Show - Bonus');
    });
    await test.step('Then "Show" is still one tile, now saying it has 4 videos', async () => {
      const tile = page.getByTestId('series-item').filter({ hasText: 'Show' });
      await expect(tile).toHaveCount(1);
      await expect(tile).toContainText('4 videos');
    });
    await test.step('When I tap the "Show" tile', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).click();
    });
    await test.step('Then its episodes come first in order, then "Bonus"', async () => {
      await expect(page.getByTestId('episode-item')).toHaveText(['S01E01 · First', 'S01E02 · Second', 'S01E10 · Tenth', 'Bonus']);
    });
  });
});
