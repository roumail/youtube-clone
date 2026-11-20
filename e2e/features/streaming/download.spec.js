// Feature: Download a streamed video — for a trip or a bad connection, a parent
// downloads a streamed video onto this device: it then plays and seeks with no
// connection, like a stored one. A download is short-lived and may be lost
// (the browser can clear it, or the parent removes it); the video then simply
// streams again. Only streamed videos offer Download: a stored video is
// already on the device. Google is faked at the network boundary.
// Not @ipad, for the same reason as add-from-drive.spec.js.
import {
  test, expect, goto, enterPin, openVideo, startPlaying, expectPlaying, fixtureContainer, fakeGoogle, freeSpace,
  containerSize, playerState, PIN,
} from '../../support.js';

const shared = () => ({
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
});

async function streamFromDrive(page, google, ...names) {
  await google.willPick(...names);
  await page.getByTestId('add-from-drive-button').click();
  await enterPin(page, PIN);
  await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', /done|error/);
}

const item = (page, title) => page.getByTestId('library-item').filter({ hasText: title });

async function download(page, title) {
  await item(page, title).getByTestId('download-button').tap();
  await enterPin(page, PIN);
}

test.describe('Feature: Download a streamed video', () => {
  test.fixme('Scenario: a streamed video offers Download in the library; a stored one does not', async ({ page, pinSet, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is stored and "medium" is streamed', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('Then only "medium" offers Download', async () => {
      await expect(item(page, 'medium').getByTestId('download-button')).toBeVisible();
      await expect(item(page, 'tiny').getByTestId('download-button')).toHaveCount(0);
    });
  });

  test.fixme('Scenario: downloading needs the PIN', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I tap Download and cancel the PIN', async () => {
      await item(page, 'medium').getByTestId('download-button').tap();
      await page.getByTestId('pin-cancel').tap();
    });
    await test.step('Then nothing is downloaded', async () => {
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
    });
  });

  test.fixme('Scenario: a downloaded video is marked as downloaded and plays with no connection to Google Drive', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I download it with the PIN', async () => {
      await download(page, 'medium');
    });
    await test.step('Then it is marked as downloaded', async () => {
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
    await test.step('And with Google Drive unreachable, it opens, plays and seeks', async () => {
      google.dropConnection('medium.kidsvideo');
      await openVideo(page, 'medium');
      await startPlaying(page);
      const box = await page.getByTestId('seek-bar').boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: a download shows its progress, and the video can be watched while it downloads', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I download it', async () => {
      await download(page, 'medium');
    });
    await test.step('Then its progress is shown until it is done', async () => {
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', /downloading|true/);
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
  });

  test.fixme('Scenario: a download that does not fit is refused before it starts', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and there is room for only half of it', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await freeSpace(page, Math.floor(containerSize('medium') / 2));
    });
    await test.step('When I download it', async () => {
      await download(page, 'medium');
    });
    await test.step('Then it is refused for lack of space, and it still streams', async () => {
      await expect(page.getByTestId('import-status')).toContainText(/not enough space on this device \("medium" needs [\d.]+ MB, [\d.]+ MB is free\)/);
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
    });
  });

  test.fixme('Scenario: if the connection drops during a download, nothing is left half-downloaded', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When the connection to Google Drive drops while it downloads', async () => {
      google.dropConnection('medium.kidsvideo');
      await download(page, 'medium');
    });
    await test.step('Then the download says the connection was lost, and it is not marked as downloaded', async () => {
      await expect(page.getByTestId('import-status')).toContainText('the connection to Google Drive was lost');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
    });
  });

  test.fixme('Scenario: removing a download frees the space, and the video streams again', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and downloaded, and settings is unlocked', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
      await page.getByTestId('settings-button').tap();
      await enterPin(page, PIN);
    });
    await test.step('When I remove its download', async () => {
      await page.getByTestId('settings-video-item').filter({ hasText: 'medium' })
        .getByTestId('remove-download-button').tap();
    });
    await test.step('Then it is still listed, streamed, and plays from Google Drive', async () => {
      await page.getByTestId('screen-settings').getByTestId('back-button').tap();
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
      const before = google.bytesRead('medium.kidsvideo');
      await openVideo(page, 'medium');
      await startPlaying(page);
      await expect.poll(() => google.bytesRead('medium.kidsvideo')).toBeGreaterThan(before);
    });
  });

  test.fixme('Scenario: a download the browser has cleared falls back to streaming', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" was downloaded, and the browser has since cleared the download', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
      await page.evaluate(async () => {
        const storage = new shaka.offline.Storage();
        for (const c of await storage.list()) await storage.remove(c.offlineUri);
        await storage.destroy();
      });
      await page.reload();
    });
    await test.step('Then it is listed as streamed, not downloaded, and still opens', async () => {
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
      await expect(item(page, 'medium')).toHaveAttribute('data-plays-from', 'drive');
    });
  });

  test.fixme('Scenario: hiding a downloaded video also removes its download', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and downloaded, and settings is unlocked', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
      await page.getByTestId('settings-button').tap();
      await enterPin(page, PIN);
    });
    await test.step('When I hide it', async () => {
      await page.getByTestId('settings-video-item').filter({ hasText: 'medium' })
        .getByTestId('hide-video-button').tap();
    });
    await test.step('Then nothing of it is left on the device', async () => {
      const left = await page.evaluate(async () => {
        const storage = new shaka.offline.Storage();
        const n = (await storage.list()).length;
        await storage.destroy();
        return n;
      });
      expect(left).toBe(0);
      await expect(playerState(page)).toBeHidden();
    });
  });
});
