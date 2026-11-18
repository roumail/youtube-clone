// Feature: Add a video — behind the PIN; pick one prepared folder's 4 files.
// The title is the .mpd file name.
import { test, expect, goto, enterPin, fixtureFiles, PIN, WRONG_PIN } from '../../support.js';

test.describe('Feature: Add a video', () => {
  test.fixme('Scenario: PIN, pick the 4 files, it appears in the library', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
    await test.step('When I tap "Add video"', async () => {
      await page.getByTestId('add-video-button').click();
    });
    await test.step('Then the PIN is required', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I enter the PIN and pick the 4 files of "tiny"', async () => {
      await enterPin(page, PIN);
      await (await chooser).setFiles(fixtureFiles('tiny'));
    });
    await test.step('Then the import completes and "tiny" is listed', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test.fixme('Scenario: adding a second video keeps the first', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "episode-like"', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles(fixtureFiles('episode-like'));
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('Then both are listed', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(2);
    });
  });

  test.fixme('Scenario: a wrong PIN opens no file picker', async ({ page, pinSet }) => {
    let pickerOpened = false;
    page.on('filechooser', () => { pickerOpened = true; });
    await test.step('Given the library is shown', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap "Add video" and enter a wrong PIN', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, WRONG_PIN);
    });
    await test.step('Then the prompt says it is wrong and no file picker opened', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
      expect(pickerOpened).toBe(false);
    });
  });

  test.fixme('Scenario: a folder with a missing file is rejected', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "broken-missing-audio" (no audio.mp4)', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles(fixtureFiles('broken-missing-audio').filter((f) => !f.endsWith('audio.mp4')));
    });
    await test.step('Then the import reports an error and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test.fixme('Scenario: a video this device cannot play is rejected and leaves nothing behind', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "unplayable" (a codec no browser supports)', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles(fixtureFiles('unplayable'));
    });
    await test.step('Then the import reports an error, not success', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
    });
    await test.step('And no empty "0 MB" entry is left in the library, even after a reload', async () => {
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      await page.reload();
      await expect(page.getByTestId('library-item')).toHaveCount(0);
    });
  });
});
