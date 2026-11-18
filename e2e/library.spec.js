// Rule: the library is a fixed grid of stored videos. Nothing else.
import { test, expect, goto } from './support.js';

test.fixme('stored videos appear as titled thumbnails', async ({ page, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" and "medium" are stored', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny', 'medium');
  });
  await test.step('Then the library shows exactly those two videos', async () => {
    await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('library-item')).toHaveCount(2);
  });
  await test.step('And each shows its title and a poster image', async () => {
    for (const title of ['tiny', 'medium']) {
      const item = page.getByTestId('library-item').filter({ hasText: title });
      await expect(item).toBeVisible();
      await expect(item.locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
    }
  });
});

test.fixme('the library survives a reload', async ({ page, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" is stored', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny');
  });
  await test.step('When I reload the app', async () => {
    await page.reload();
  });
  await test.step('Then "tiny" is still in the library', async () => {
    await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
  });
});

test.fixme('opening a video does not start it', async ({ page, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" is stored', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny');
  });
  await test.step('When I tap "tiny"', async () => {
    await page.getByTestId('library-item').filter({ hasText: 'tiny' }).click();
  });
  await test.step('Then the player shows it paused at the start', async () => {
    await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
    const t = await page.getByTestId('player-video').evaluate((v) => ({ paused: v.paused, time: v.currentTime }));
    expect(t).toEqual({ paused: true, time: 0 });
  });
});
