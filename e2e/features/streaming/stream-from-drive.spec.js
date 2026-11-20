// Feature: Stream from Google Drive — a video picked in Google Drive can be
// streamed instead of stored: this device keeps only its title and poster in
// its catalogue, and plays the video from the shelf (the Kids Library in
// Google Drive) while the child watches. Streaming needs the internet; a
// stored copy doesn't. After picking, the parent chooses per add: "Stream" or
// "Keep a copy on this device" (what "Add from Google Drive" does today).
// Google is faked at the network boundary (fakeGoogle in e2e/support.js).
// Not @ipad, for the same reason as add-from-drive.spec.js.
import { statSync } from 'node:fs';
import {
  test, expect, goto, enterPin, openVideo, startPlaying, expectPlaying, fixtureContainer, fixtureParts, fakeGoogle,
  freeSpace, containerSize, playerState, PIN,
} from '../../support.js';

const shared = () => ({
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
});

// Bytes a streamed add may read: kidsvideo.json, the manifest and the poster,
// never the audio or video.
const headerAndPoster = (name) => {
  const [, , , poster] = fixtureParts(name);
  return 64 * 1024 + statSync(poster).size;
};

async function streamFromDrive(page, google, ...names) {
  await google.willPick(...names);
  await page.getByTestId('add-from-drive-button').click();
  await enterPin(page, PIN);
  await page.getByTestId('add-choice-stream').click();
}

test.describe('Feature: Stream from Google Drive', () => {
  test.fixme('Scenario: after picking, the parent chooses to stream or to keep a copy', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
      await google.willPick('tiny.kidsvideo');
    });
    await test.step('When I add "tiny.kidsvideo" from Google Drive', async () => {
      await page.getByTestId('add-from-drive-button').click();
      await enterPin(page, PIN);
    });
    await test.step('Then I am asked: "Stream" or "Keep a copy on this device"', async () => {
      await expect(page.getByTestId('add-choice-stream')).toBeVisible();
      await expect(page.getByTestId('add-choice-keep')).toBeVisible();
    });
  });

  test.fixme('Scenario: a streamed video is listed with title and poster, marked as streamed, after reading only its start', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I stream "tiny.kidsvideo" from Google Drive', async () => {
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then "tiny" is listed with its poster and marked as streamed', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny" (streams from Google Drive).');
      const item = page.getByTestId('library-item').filter({ hasText: 'tiny' });
      await expect(item).toHaveAttribute('data-plays-from', 'drive');
      await expect(item.locator('img')).toBeVisible();
    });
    await test.step('And none of its audio or video was downloaded', async () => {
      expect(google.bytesRead('tiny.kidsvideo')).toBeLessThanOrEqual(headerAndPoster('tiny'));
    });
  });

  test.fixme('Scenario: a stored video is marked as stored', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored on this device', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    await test.step('Then it is marked as playing from this device', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toHaveAttribute('data-plays-from', 'device');
    });
  });

  test.fixme('Scenario: a streamed video plays after the PIN, reading from Google Drive as it plays', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    const before = google.bytesRead('tiny.kidsvideo');
    await test.step('When I open it and play with the PIN', async () => {
      await openVideo(page, 'tiny');
      await startPlaying(page);
    });
    await test.step('Then it plays, and its video is read from Google Drive', async () => {
      await expect.poll(() => google.bytesRead('tiny.kidsvideo')).toBeGreaterThan(before);
    });
  });

  test.fixme('Scenario: seeking in a streamed video plays from the new position', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and playing', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await openVideo(page, 'medium');
      await startPlaying(page);
    });
    await test.step('When I seek to the middle', async () => {
      const box = await page.getByTestId('seek-bar').boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    });
    await test.step('Then it plays on from there', async () => {
      await expectPlaying(page);
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBeGreaterThan(1);
    });
  });

  test.fixme('Scenario: when this session\'s Google sign-in has run out, the PIN for play asks to sign in again, then it plays', async ({ page, pinSet }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is streamed, and an hour has passed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo');
      await page.clock.fastForward('01:00:00');
    });
    await test.step('When I open it and play with the PIN', async () => {
      await openVideo(page, 'tiny');
      await page.getByTestId('play-button').tap();
      await enterPin(page, PIN);
    });
    await test.step('Then Google\'s sign-in is shown again, and it plays', async () => {
      await expect.poll(() => google.signIns()).toBe(2);
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: a film longer than an hour keeps playing when the Google sign-in runs out (known gap)', async ({ page, pinSet }) => {
    // Google's sign-in in the browser lasts about an hour; renewing it in the
    // middle of a film, without a tap, may be blocked on the iPad. Not solved yet.
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "medium" is streamed and playing', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await openVideo(page, 'medium');
      await startPlaying(page);
    });
    await test.step('When the sign-in runs out while it plays', async () => {
      await page.clock.fastForward('01:00:00');
    });
    await test.step('Then it keeps playing', async () => {
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: with no internet, a streamed video says it needs the internet; a stored one still plays', async ({ page, pinSet, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is stored and "medium" is streamed', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await streamFromDrive(page, google, 'medium.kidsvideo');
    });
    await test.step('When the connection is gone and I play "medium"', async () => {
      await page.context().setOffline(true);
      await openVideo(page, 'medium');
      await page.getByTestId('play-button').tap();
      await enterPin(page, PIN);
    });
    await test.step('Then it says it needs the internet', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'error');
      await expect(page.getByTestId('player-error')).toHaveText('"medium" streams from Google Drive and needs the internet.');
    });
    await test.step('And "tiny" still plays', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').tap();
      await openVideo(page, 'tiny');
      await startPlaying(page);
    });
  });

  test.fixme('Scenario: a streamed video the account can no longer read says so when played', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('When it is no longer shared with the account and I play it', async () => {
      google.deny('tiny.kidsvideo');
      await openVideo(page, 'tiny');
      await page.getByTestId('play-button').tap();
      await enterPin(page, PIN);
    });
    await test.step('Then it says there is no access to it in Google Drive', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'error');
      await expect(page.getByTestId('player-error')).toHaveText('no access to "tiny.kidsvideo" in Google Drive');
    });
  });

  test.fixme('Scenario: streamed videos stay in the catalogue after a reload', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('When I reload the app', async () => {
      await page.reload();
    });
    await test.step('Then "tiny" is still listed as streamed', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toHaveAttribute('data-plays-from', 'drive');
    });
  });

  test.fixme('Scenario: removing a streamed video only takes it off this device\'s catalogue', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
    });
    await test.step('When I remove "tiny" in Settings', async () => {
      await page.getByTestId('settings-button').tap();
      await enterPin(page, PIN);
      await page.getByTestId('settings-video-item').filter({ hasText: 'tiny' })
        .getByTestId('remove-video-button').tap();
    });
    await test.step('Then only "medium" is listed, and Google Drive was only ever read', async () => {
      await page.getByTestId('screen-settings').getByTestId('back-button').tap();
      await expect(page.getByTestId('library-item')).toHaveCount(1);
      await expect(page.getByTestId('library-item').filter({ hasText: 'medium' })).toBeVisible();
      expect(google.requestsOtherThanReads()).toBe(0);
    });
  });

  test.fixme('Scenario: a title already in the catalogue is refused, stored or streamed', async ({ page, pinSet, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    await test.step('When I stream "tiny.kidsvideo" from Google Drive', async () => {
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then it is refused as already in the library, and listed once', async () => {
      await expect(page.getByTestId('import-status')).toContainText('"tiny" is already in the library');
      await expect(page.getByTestId('library-item')).toHaveCount(1);
    });
  });

  test.fixme('Scenario: streaming needs no free space for the video itself', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given there is room for only half of "tiny"', async () => {
      await freeSpace(page, Math.floor(containerSize('tiny') / 2));
      await goto(page, '#/library');
    });
    await test.step('When I stream "tiny.kidsvideo" from Google Drive', async () => {
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then it is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny" (streams from Google Drive).');
    });
  });
});
