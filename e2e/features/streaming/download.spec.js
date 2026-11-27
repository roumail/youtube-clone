// Feature: Download a streamed video — for a trip or a bad connection, a parent
// downloads a streamed video onto this device: it then plays and seeks with no
// connection, like a stored one. A download is short-lived and may be lost
// (the browser can clear it, or the parent removes it); the video then simply
// streams again. Only streamed videos offer Download: a stored video is
// already on the device. A download can be cancelled while it runs. Several
// can run at once; each has its own row and Cancel (progress-rows.spec.js).
// Google is faked at the network boundary.
// Not @ipad, for the same reason as add-from-drive.spec.js.
import {
  test, expect, goto, openVideo, startPlaying, expectPlaying, fixtureContainer, fakeGoogle,
  freeSpace, containerSize, playerState, tapContinue, signInDue, selectVideos,
} from '../../support.js';

const shared = () => ({
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
});

// Added from Google Drive after Face ID; the first time, the sign-in is due,
// so "Continue" is tapped for it (unlock.spec.js).
async function streamFromDrive(page, google, ...names) {
  await google.willPick(...names);
  const signingIn = await signInDue(page);
  await page.getByTestId('add-from-drive-button').click();
  if (signingIn) await tapContinue(page);
  await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', /done|error/);
}

const item = (page, title) => page.getByTestId('library-item').filter({ hasText: title });
const row = (page, text) => page.getByTestId('import-status').filter({ hasText: text });

// After Face ID; signed in already (by the add), so no "Continue".
async function download(page, title) {
  await item(page, title).getByTestId('download-button').tap();
}

test.describe('Feature: Download a streamed video', () => {
  test('Scenario: a streamed video offers Download in the library; a stored one does not', async ({ page, setUp, seedLibrary }) => {
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

  test('Scenario: downloading needs Face ID', async ({ page, setUp, faceId }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I tap Download, Face ID fails, and I cancel', async () => {
      await faceId.willFail();
      await item(page, 'medium').getByTestId('download-button').tap();
      await page.getByTestId('unlock-cancel').tap();
    });
    await test.step('Then nothing is downloaded', async () => {
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
    });
  });

  test('Scenario: a downloaded video is marked as downloaded and plays with no connection to Google Drive', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I download it with Face ID', async () => {
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

  test('Scenario: a download shows its progress, and the video can be watched while it downloads', async ({ page, setUp }) => {
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

  test('Scenario: a download can be cancelled; nothing of it is kept, and it still streams', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    let release;
    await test.step('Given "medium" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I download it and tap Cancel while it downloads', async () => {
      release = google.holdReads('medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'downloading');
      await page.getByTestId('cancel-download-button').tap();
      release();
    });
    await test.step('Then the download says it was cancelled, and nothing of it is kept', async () => {
      await expect(row(page, 'Download of "medium" cancelled.')).toHaveAttribute('data-import', 'cancelled');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
      await expect(page.getByTestId('cancel-download-button')).toBeHidden();
      await expect.poll(() => page.evaluate(async () => {
        const storage = new shaka.offline.Storage();
        const n = (await storage.list()).length;
        await storage.destroy();
        return n;
      })).toBe(0);
    });
  });

  test('Scenario: a download that does not fit is refused before it starts', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and there is room for only half of it', async () => {
      await freeSpace(page, Math.floor(containerSize('medium') / 2));
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When I download it', async () => {
      await download(page, 'medium');
    });
    await test.step('Then it is refused for lack of space, and it still streams', async () => {
      await expect(row(page, /not enough space on this device \("medium" needs [\d.]+ MB, [\d.]+ MB is free\)/)).toHaveAttribute('data-import', 'error');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
    });
  });

  test('Scenario: if the connection drops during a download, nothing is left half-downloaded', async ({ page, setUp }) => {
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
      await expect(row(page, 'Couldn\'t download "medium": the connection to Google Drive was lost')).toHaveAttribute('data-import', 'error');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'false');
    });
  });

  test('Scenario: removing a download frees the space, and the video streams again', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and downloaded, and settings is unlocked', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
      await page.getByTestId('settings-button').tap();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('When I remove its download from the "Downloads" list', async () => {
      await expect(page.getByTestId('downloads-heading')).toBeVisible();
      await page.getByTestId('settings-download-item').filter({ hasText: 'medium' })
        .getByTestId('remove-download-button').tap();
      await expect(page.getByTestId('settings-download-item')).toHaveCount(0);
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

  test('Scenario: a download the browser has cleared falls back to streaming', async ({ page, setUp }) => {
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

  test('Scenario: removing a downloaded video also removes its download', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and downloaded', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
    await test.step('When I tick it, tap "Remove 1" and pass Face ID', async () => {
      await selectVideos(page, 'medium');
      await page.getByTestId('selection-remove').tap();
    });
    await test.step('Then nothing of it is left on the device', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(0);
      await expect.poll(() => page.evaluate(async () => {
        const storage = new shaka.offline.Storage();
        const n = (await storage.list()).length;
        await storage.destroy();
        return n;
      })).toBe(0);
      await expect(playerState(page)).toBeHidden();
    });
  });

  // Several downloads at once. Each is started in turn while the earlier one
  // is still running, so a Cancel or a failure that reaches the wrong
  // download shows up whichever order they were started in.

  test('Scenario: two downloads at once both finish', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    let releaseTiny;
    let releaseMedium;
    await test.step('Given "tiny" and "medium" are streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
    });
    await test.step('When I download "tiny", and "medium" while "tiny" still downloads', async () => {
      releaseTiny = google.holdReads('tiny.kidsvideo');
      releaseMedium = google.holdReads('medium.kidsvideo');
      await download(page, 'tiny');
      await download(page, 'medium');
    });
    await test.step('Then both say they are downloading, and neither offers Download again', async () => {
      for (const title of ['tiny', 'medium']) {
        await expect(item(page, title)).toHaveAttribute('data-downloaded', 'downloading');
        await expect(item(page, title).getByTestId('download-button')).toHaveCount(0);
      }
    });
    await test.step('And when Google Drive answers, both are downloaded', async () => {
      releaseTiny();
      releaseMedium();
      await expect(item(page, 'tiny')).toHaveAttribute('data-downloaded', 'true');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
    await test.step('And each download holds its own video, not the other one', async () => {
      const lengths = await page.evaluate(async () => {
        const storage = new shaka.offline.Storage();
        const list = await storage.list();
        await storage.destroy();
        return Object.fromEntries(list.map((c) => [c.appMetadata.title, Math.round(c.duration)]));
      });
      expect(lengths).toEqual({ tiny: 3, medium: 60 });
    });
  });

  for (const [cancelled, other, which] of [['tiny', 'medium', 'first'], ['medium', 'tiny', 'second']]) {
    test(`Scenario: with two downloads at once, Cancel on the ${which} one stops only that one`, async ({ page, setUp }) => {
      const google = await fakeGoogle(page, shared());
      const release = {};
      await test.step('Given "tiny" and "medium" are streamed, and both are downloading, "tiny" started first', async () => {
        await goto(page, '#/library');
        await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
        release.tiny = google.holdReads('tiny.kidsvideo');
        release.medium = google.holdReads('medium.kidsvideo');
        await download(page, 'tiny');
        await expect(item(page, 'tiny')).toHaveAttribute('data-downloaded', 'downloading');
        await download(page, 'medium');
        await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'downloading');
      });
      await test.step(`When I tap Cancel in the row of "${cancelled}"`, async () => {
        await row(page, `Downloading "${cancelled}"`).getByTestId('cancel-download-button').tap();
        release[cancelled]();
      });
      await test.step(`Then "${cancelled}" is cancelled and nothing of it is kept`, async () => {
        await expect(row(page, `Download of "${cancelled}" cancelled.`)).toBeVisible();
        await expect(item(page, cancelled)).toHaveAttribute('data-downloaded', 'false');
      });
      await test.step(`And "${other}" still downloads to the end`, async () => {
        await expect(item(page, other)).toHaveAttribute('data-downloaded', 'downloading');
        await expect(row(page, `Downloading "${other}"`).getByTestId('cancel-download-button')).toBeVisible();
        release[other]();
        await expect(item(page, other)).toHaveAttribute('data-downloaded', 'true');
        await expect(row(page, `Downloaded "${other}".`)).toBeVisible();
      });
    });
  }

  test('Scenario: with two downloads at once, a lost connection fails only the one it hits', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    let releaseMedium;
    await test.step('Given "tiny" and "medium" are streamed, and "medium" is downloading', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
      releaseMedium = google.holdReads('medium.kidsvideo');
      await download(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'downloading');
    });
    await test.step('When I download "tiny" too and the connection drops for it', async () => {
      google.dropConnection('tiny.kidsvideo');
      await download(page, 'tiny');
    });
    await test.step('Then "tiny" says the connection was lost, and "medium" still downloads to the end', async () => {
      await expect(row(page, 'the connection to Google Drive was lost')).toContainText('tiny');
      await expect(item(page, 'tiny')).toHaveAttribute('data-downloaded', 'false');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'downloading');
      releaseMedium();
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
  });
});
