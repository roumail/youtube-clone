// Feature: Add several videos in one go — pick a whole season's .kidsvideo
// files at once; they're imported one after another with progress.
import { test, expect, goto, enterPin, fixtureContainer, fixtureParts, PIN } from '../../support.js';

const SEASON = ['Show - S01E01 - First', 'Show - S01E02 - Second', 'Show - S01E10 - Tenth'];

test.describe('Feature: Add several videos in one go', () => {
  test('Scenario: picking 3 episodes adds all 3, one after another', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick the 3 .kidsvideo files of a season at once', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles(SEASON.map(fixtureContainer));
    });
    await test.step('Then progress names which one is being added ("2 of 3")', async () => {
      await expect(page.getByTestId('import-status')).toContainText(/of 3/);
    });
    await test.step('And all 3 end up in the library', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await expect(page.getByTestId('import-status')).toContainText('3');
    });
  });

  test('Scenario: one bad file does not stop the others', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "tiny.kidsvideo", "broken-missing-audio.kidsvideo" and "medium.kidsvideo"', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles(['tiny', 'broken-missing-audio', 'medium'].map(fixtureContainer));
    });
    await test.step('Then the 2 good ones are added and the summary names the one that failed', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('broken-missing-audio');
      await page.reload();
      await expect(page.getByTestId('library-item')).toHaveCount(2);
    });
  });

  test('Scenario: anything that is not a .kidsvideo is refused by name, the rest are added', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "tiny.kidsvideo" together with a loose "video.mp4"', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles([fixtureContainer('tiny'), fixtureParts('medium')[1]]);
    });
    await test.step('Then "tiny" is added and video.mp4 is reported as not a .kidsvideo', async () => {
      await expect(page.getByTestId('import-status')).toContainText('video.mp4');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });
});
