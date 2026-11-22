// Feature: Add a video — behind Face ID; then "Continue" opens the file picker
// (it must open within a tap: unlock.spec.js); pick the video's one .kidsvideo file.
// The title is the .mpd file name.
import { readFileSync } from 'node:fs';
import {
  test, expect, goto, expectPlaying, fixtureContainer, fixtureParts, tapContinue,
} from '../../support.js';

test.describe('Feature: Add a video', () => {
  test('Scenario: Face ID, Continue, pick the .kidsvideo, it appears in the library @ipad', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
    await test.step('When I tap "Add video" and pass Face ID', async () => {
      await page.getByTestId('add-video-button').tap();
    });
    await test.step('Then "Continue" is shown', async () => {
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'continue');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I tap "Continue" and pick "tiny.kidsvideo"', async () => {
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('tiny')]);
    });
    await test.step('Then the import completes and "tiny" is listed', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test('Scenario: adding a second video keeps the first', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "episode-like"', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('episode-like')]);
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('Then both are listed', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(2);
    });
  });

  test('Scenario: a failed Face ID opens no file picker', async ({ page, setUp, faceId }) => {
    let pickerOpened = false;
    page.on('filechooser', () => { pickerOpened = true; });
    await test.step('Given the library is shown', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap "Add video" and Face ID fails', async () => {
      await faceId.willFail();
      await page.getByTestId('add-video-button').click();
    });
    await test.step('Then the unlock prompt shows, with no "Continue", and no file picker opened', async () => {
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'unlock');
      await expect(page.getByTestId('unlock-continue-button')).toBeHidden();
      expect(pickerOpened).toBe(false);
    });
  });

  test('Scenario: loose parts instead of the .kidsvideo file are refused', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick the 4 loose parts of "tiny" instead of its .kidsvideo', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles(fixtureParts('tiny'));
    });
    await test.step('Then the import says to pick the .kidsvideo file, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('.kidsvideo');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a video this device cannot play is rejected and leaves nothing behind', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "unplayable" (a codec no browser supports)', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
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

  test('Scenario: the library explains which files to pick', async ({ page, setUp }) => {
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

  // iPad: Safari opens a file picker only *during* a tap. Face ID takes a
  // moment, so the tap that asked for it no longer counts; the picker opens
  // on the tap on "Continue", with nothing awaited in between.
  test('Scenario: after Face ID, "Continue" opens the file picker at once @ipad', async ({ page, setUp }) => {
    await test.step('Given the library is shown', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser', { timeout: 4000 });
    await test.step('When I tap "Add video", pass Face ID and tap "Continue"', async () => {
      await page.getByTestId('add-video-button').tap();
      await tapContinue(page);
    });
    await test.step('Then the file picker opens straight away', async () => {
      await chooser;
    });
  });

  test('Scenario: a .kidsvideo with a missing part is rejected and adds nothing', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "broken-missing-audio.kidsvideo" (no audio.mp4 inside)', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('broken-missing-audio')]);
    });
    await test.step('Then the import reports the missing part and the library stays empty', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('audio.mp4');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a video that is already in the library is refused, not added twice', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given "tiny" is already in the library', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "tiny.kidsvideo" again', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('tiny')]);
    });
    await test.step('Then it is refused as already in the library, and there is still one "tiny"', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toContainText('already in the library');
      await page.reload();
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toHaveCount(1);
    });
  });

  test('Scenario: a single file that is not a .kidsvideo is refused by name', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick only the loose "video.mp4" of "tiny"', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureParts('tiny')[1]]);
    });
    await test.step('Then the import says video.mp4 isn\'t a .kidsvideo file, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: video.mp4 isn't a .kidsvideo file");
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  // 95 bytes: the longest title tools/kidsvideo accepts.
  test('Scenario: a video with the longest allowed title adds and plays', async ({ page, setUp }) => {
    const title = 'The Longest Title Allowed - A Tale About Many Long Words That Keeps Going Until It Finally Ends';
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step(`When I add "${title}.kidsvideo"`, async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer(title)]);
    });
    await test.step('Then it is listed under its full title', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await expect(page.getByTestId('library-item').filter({ hasText: title })).toBeVisible();
    });
    await test.step('And it plays after play and Face ID', async () => {
      await page.getByTestId('library-item').filter({ hasText: title }).click();
      await page.getByTestId('play-button').click();
      await expectPlaying(page);
    });
  });

  test('Scenario: a renamed file that is not really a .kidsvideo is refused', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "photo.kidsvideo" (a photo renamed to .kidsvideo)', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([{ name: 'photo.kidsvideo', mimeType: 'application/octet-stream', buffer: readFileSync(fixtureParts('tiny')[3]) }]);
    });
    await test.step('Then the import says it is not a readable .kidsvideo file, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: photo.kidsvideo isn't a readable .kidsvideo file");
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a .kidsvideo without its manifest is refused', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "no-manifest.kidsvideo" (video, audio and poster, but no .mpd)', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('no-manifest')]);
    });
    await test.step('Then the import says the manifest is missing, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: expected exactly one .mpd file, got 0");
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a video whose storing fails partway (the device fills up) leaves nothing behind', async ({ page, setUp }) => {
    await test.step('Given the device runs out of space after the first few parts of a video are stored', async () => {
      await page.addInitScript(() => {
        let writes = 0;
        for (const method of ['add', 'put']) {
          const original = IDBObjectStore.prototype[method];
          IDBObjectStore.prototype[method] = function (...args) {
            writes += 1;
            if (writes > 3) throw new DOMException('The device is full.', 'QuotaExceededError');
            return original.apply(this, args);
          };
        }
      });
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I add "medium.kidsvideo"', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('medium')]);
    });
    await test.step('Then the import reports an error', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'error');
    });
    await test.step('And nothing of "medium" is left on the device, even half-stored', async () => {
      await page.reload();
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      expect(await page.evaluate(async () => {
        const storage = new shaka.offline.Storage();
        try { return (await storage.list()).length; } finally { await storage.destroy(); }
      })).toBe(0);
    });
  });

  test('Scenario: a .kidsvideo made by the older tools is refused, asking to prepare it again', async ({ page, setUp }) => {
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    const chooser = page.waitForEvent('filechooser');
    await test.step('When I pick "old-format.kidsvideo" (made before format 2: no kidsvideo.json inside)', async () => {
      await page.getByTestId('add-video-button').click();
      await tapContinue(page);
      await (await chooser).setFiles([fixtureContainer('old-format')]);
    });
    await test.step('Then the import says to prepare it again, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: old-format.kidsvideo was made by an older version of the tools: prepare it again");
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });
});
