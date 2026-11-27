// Feature: Remove videos — from the selection bar, behind Face ID. Hold a
// video to start selecting (playlist.spec.js), tick more, then "Remove N".
// A stored video's copy is deleted from the device; a streamed one is hidden
// from this device: it stays in Google Drive and can be added again, and its
// download goes too (stream-from-drive.spec.js, download.spec.js). Ticking is
// free; removing needs Face ID. Settings lists only downloads.
import { test, expect, goto, selectVideos } from '../../support.js';

const tile = (page, title) => page.getByTestId('library-item').filter({ hasText: title });

test.describe('Feature: Remove videos', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
    await page.clock.install();
    await goto(page, '#/library');
    await seedLibrary('tiny', 'medium', 'Second');
  });

  test('Scenario: ticking videos offers "Remove" with their number next to "Play"', async ({ page }) => {
    await test.step('When I hold "tiny" and tap "medium"', async () => {
      await selectVideos(page, 'tiny', 'medium');
    });
    await test.step('Then the selection bar offers "Play 2" and "Remove 2"', async () => {
      await expect(page.getByTestId('selection-play')).toHaveText('Play 2');
      await expect(page.getByTestId('selection-remove')).toHaveText('Remove 2');
    });
  });

  test('Scenario: removing the ticked videos after Face ID leaves the others', async ({ page }) => {
    await test.step('Given "tiny" and "medium" are ticked', async () => {
      await selectVideos(page, 'tiny', 'medium');
    });
    await test.step('When I tap "Remove 2" and pass Face ID', async () => {
      await page.getByTestId('selection-remove').tap();
    });
    await test.step('Then only "Second" is left, and nothing is ticked', async () => {
      await expect(page.getByTestId('library-item')).toHaveText([/Second/]);
      await expect(page.getByTestId('selection-bar')).toBeHidden();
    });
    await test.step('And after a reload they are still gone', async () => {
      await page.reload();
      await expect(page.getByTestId('library-item')).toHaveText([/Second/]);
    });
  });

  test('Scenario: without Face ID nothing is removed, and the ticks stay', async ({ page, faceId }) => {
    await test.step('Given "tiny" is ticked', async () => {
      await selectVideos(page, 'tiny');
    });
    await test.step('When I tap "Remove 1", Face ID fails, and I cancel', async () => {
      await faceId.willFail();
      await page.getByTestId('selection-remove').tap();
      await page.getByTestId('unlock-cancel').tap();
    });
    await test.step('Then all 3 are still listed, and "tiny" is still ticked', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(3);
      await expect(tile(page, 'tiny')).toHaveAttribute('aria-checked', 'true');
    });
  });

  test('Scenario: settings lists no videos to remove when nothing is downloaded', async ({ page }) => {
    await test.step('When I open settings with Face ID', async () => {
      await page.getByTestId('settings-button').tap();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('Then it lists no videos and no "Downloads" heading', async () => {
      await expect(page.getByTestId('settings-download-item')).toHaveCount(0);
      await expect(page.getByTestId('downloads-heading')).toBeHidden();
    });
  });
});
