// Feature: Add a video — behind the PIN; pick the video's one .kidsvideo file.
// The title is the .mpd file name.
import { test, expect, goto, enterPin, fixtureContainer, fixtureParts, PIN, WRONG_PIN } from '../../support.js';

test.describe('Feature: Add a video', () => {
  test('Scenario: PIN, pick the .kidsvideo, it appears in the library', async ({ page, pinSet }) => {
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
    await test.step('When I enter the PIN and pick "tiny.kidsvideo"', async () => {
      await enterPin(page, PIN);
      await (await chooser).setFiles([fixtureContainer('tiny')]);
    });
    await test.step('Then the import completes and "tiny" is listed', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test('Scenario: adding a second video keeps the first', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "episode-like"', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles([fixtureContainer('episode-like')]);
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('Then both are listed', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(2);
    });
  });

  test('Scenario: a wrong PIN opens no file picker', async ({ page, pinSet }) => {
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

  test('Scenario: loose parts instead of the .kidsvideo file are refused', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick the 4 loose parts of "tiny" instead of its .kidsvideo', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles(fixtureParts('tiny'));
    });
    await test.step('Then the import says to pick the .kidsvideo file, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('.kidsvideo');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a video this device cannot play is rejected and leaves nothing behind', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "unplayable" (a codec no browser supports)', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles([fixtureContainer('unplayable')]);
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

  test('Scenario: the library explains which files to pick', async ({ page, pinSet }) => {
    await test.step('Given the library is shown', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then it says to pick the .kidsvideo file', async () => {
      const help = page.getByTestId('import-help');
      await expect(help).toBeVisible();
      for (const name of ['.kidsvideo']) {
        await expect(help).toContainText(name);
      }
    });
  });

  // iPad bug (v1.0.0–v1.0.2): Safari opens a file picker only *during* the
  // tap; the app hashed the PIN asynchronously first, so the picker came too
  // late and silently never opened. Chrome allows 5 s after a tap, so this
  // test slows the browser's async hashing to 6 s: any async step between the
  // tap and the picker then fails here too, deterministically.
  test('Scenario: after the correct PIN the file picker opens at once, even on a slow device @ipad', async ({ page, pinSet }) => {
    await test.step('Given a device where asynchronous hashing takes 6 seconds', async () => {
      await page.addInitScript(() => {
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = (...args) => new Promise((resolve) => { setTimeout(resolve, 6000); }).then(() => digest(...args));
      });
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser', { timeout: 4000 });
    await test.step('When I tap "Add video" and enter the correct PIN', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
    });
    await test.step('Then the file picker opens straight away', async () => {
      await chooser;
    });
  });

  test('Scenario: a .kidsvideo with a missing part is rejected and adds nothing', async ({ page, pinSet }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "broken-missing-audio.kidsvideo" (no audio.mp4 inside)', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles([fixtureContainer('broken-missing-audio')]);
    });
    await test.step('Then the import reports the missing part and the library stays empty', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('audio.mp4');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a video that is already in the library is refused, not added twice', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is already in the library', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "tiny.kidsvideo" again', async () => {
      await page.getByTestId('add-video-button').click();
      await enterPin(page, PIN);
      await (await chooser).setFiles([fixtureContainer('tiny')]);
    });
    await test.step('Then it is refused as already in the library, and there is still one "tiny"', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('already in the library');
      await page.reload();
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toHaveCount(1);
    });
  });
});
