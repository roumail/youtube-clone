// Feature: Browse the library — a fixed grid of stored videos, nothing else.
import { test, expect, goto } from '../../support.js';

test.describe('Feature: Browse the library', () => {
  test('Scenario: an empty library says so', async ({ page, pinSet }) => {
    await test.step('Given no videos are stored', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the library shows its empty state', async () => {
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      await expect(page.getByTestId('library-item')).toHaveCount(0);
    });
  });

  test('Scenario: several stored videos each appear with title and poster', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny", "medium" and "episode-like" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium', 'episode-like');
    });
    await test.step('Then the library shows exactly those three', async () => {
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'ready');
      await expect(page.getByTestId('library-item')).toHaveCount(3);
    });
    await test.step('And each shows its title and a poster image', async () => {
      for (const title of ['tiny', 'medium', 'episode-like']) {
        const item = page.getByTestId('library-item').filter({ hasText: title });
        await expect(item).toBeVisible();
        await expect(item.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
      }
    });
  });

  test('Scenario: the library survives a reload', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    await test.step('When I reload the app', async () => {
      await page.reload();
    });
    await test.step('Then "tiny" is still listed', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test('Scenario: episodes of a series are listed together, in episode order', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given three episodes of "Show" (stored out of order) and "tiny" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('Show - S01E10 - Tenth', 'tiny', 'Show - S01E02 - Second', 'Show - S01E01 - First');
    });
    await test.step('Then the episodes appear together, E01, E02, E10, and the other video by name', async () => {
      await expect(page.getByTestId('library-item')).toHaveText([
        /Show - S01E01 - First/,
        /Show - S01E02 - Second/,
        /Show - S01E10 - Tenth/,
        /tiny/,
      ]);
    });
  });
});
