// Feature: Storage space — a video is added when its real size fits in the
// space the browser gives the app, and refused up front when it doesn't.
// Films declare a peak bitrate far above their average, so the size must come
// from the picked file, not from the manifest's bitrate. "high-peak" is "tiny"
// with its declared bitrate raised 100x. The free space is set through
// navigator.storage.estimate, as the browser reports it.
import {
  test, expect, goto, fixtureContainer, freeSpace, declaredSize, containerSize, tapContinue,
} from '../../support.js';

async function addVideo(page, name) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-video-button').click();
  await tapContinue(page);
  await (await chooser).setFiles([fixtureContainer(name)]);
}

test.describe('Feature: Storage space', () => {
  test('Scenario: a video that fits is added, even when its declared bitrate suggests it is much bigger', async ({ page, setUp }) => {
    const free = containerSize('high-peak') * 2;
    await test.step('Given there is room for twice the video\'s real size, but not for the size its bitrate suggests', async () => {
      expect(declaredSize('high-peak')).toBeGreaterThan(free);
      await freeSpace(page, free);
      await goto(page, '#/library');
    });
    await test.step('When I add "high-peak"', async () => {
      await addVideo(page, 'high-peak');
    });
    await test.step('Then it is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await expect(page.getByTestId('library-item').filter({ hasText: 'high-peak' })).toBeVisible();
    });
  });

  test('Scenario: a video that does not fit is refused up front and leaves nothing behind', async ({ page, setUp }) => {
    await test.step('Given there is room for only half of "tiny"', async () => {
      await freeSpace(page, Math.floor(containerSize('tiny') / 2));
      await goto(page, '#/library');
    });
    await test.step('When I add "tiny"', async () => {
      await addVideo(page, 'tiny');
    });
    await test.step('Then the import says there is not enough space, with the size needed and the space free', async () => {
      const status = page.getByTestId('import-status');
      await expect(status).toHaveAttribute('data-import', 'error');
      await expect(status).toContainText('not enough space');
      await expect(status).toContainText(/needs [\d.]+ MB, [\d.]+ MB is free/);
    });
    await test.step('And nothing is added, even after a reload', async () => {
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      await page.reload();
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });
});
