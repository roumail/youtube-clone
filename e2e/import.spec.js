// Rule: adding a video is behind the PIN. The parent picks one packaged
// folder's 4 files; the title is the .mpd file name.
import { test, expect, goto, enterPin, fixtureFiles, PIN, WRONG_PIN } from './support.js';

test.fixme('add a video: PIN, pick the 4 files, it appears with progress', async ({ page, pinSet }) => {
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
  await test.step('When I enter the correct PIN', async () => {
    await enterPin(page, PIN);
  });
  await test.step('And I pick the 4 files of "tiny"', async () => {
    await (await chooser).setFiles(fixtureFiles('tiny'));
  });
  await test.step('Then the import shows progress and completes', async () => {
    await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
  });
  await test.step('And "tiny" is in the library', async () => {
    await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
  });
});

test.fixme('add a video: a wrong PIN opens no file picker', async ({ page, pinSet }) => {
  let pickerOpened = false;
  page.on('filechooser', () => { pickerOpened = true; });
  await test.step('Given the library is shown', async () => {
    await goto(page, '#/library');
  });
  await test.step('When I tap "Add video" and enter a wrong PIN', async () => {
    await page.getByTestId('add-video-button').click();
    await enterPin(page, WRONG_PIN);
  });
  await test.step('Then the PIN prompt says it is wrong and no file picker opened', async () => {
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
    expect(pickerOpened).toBe(false);
  });
});

test.fixme('add a video: a folder with a missing file is rejected', async ({ page, pinSet }) => {
  await test.step('Given the library is empty', async () => {
    await goto(page, '#/library');
  });
  const chooser = page.waitForEvent('filechooser');
  await test.step('When I add the files of "broken-missing-audio"', async () => {
    await page.getByTestId('add-video-button').click();
    await enterPin(page, PIN);
    await (await chooser).setFiles(fixtureFiles('broken-missing-audio').filter((f) => !f.endsWith('audio.mp4')));
  });
  await test.step('Then the import reports an error', async () => {
    await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
  });
  await test.step('And nothing was added to the library', async () => {
    await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
  });
});
