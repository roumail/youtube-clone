// Feature: Streamed videos — a video added from Google Drive streams: this
// device keeps only its title and poster in its catalogue and plays the video
// from the shelf (the Kids Library in Google Drive) while the child watches.
// Streaming needs the internet. A stored video (added with "Add video", from
// Files / AirDrop) is a copy on the device and plays offline. The catalogue
// shows which is which.
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
  await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
}

test.describe('Feature: Streamed videos', () => {
  test.fixme('Scenario: a streamed video is listed with title and poster, marked as streamed, after reading only its start', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I stream "tiny.kidsvideo" from Google Drive', async () => {
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then "tiny" is listed with its poster and marked as streamed', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny".');
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

  test.fixme('Scenario: when the Google sign-in runs out during a video, it pauses; play with the PIN signs in again and goes on from there', async ({ page, pinSet }) => {
    // Google's sign-in in the browser lasts about an hour, and renewing it needs
    // a tap. So the video pauses just before it runs out, and the play PIN (a
    // tap, needed for every resume anyway) renews it.
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    let pausedAt;
    await test.step('Given "medium" is streamed and playing', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'medium.kidsvideo');
      await openVideo(page, 'medium');
      await startPlaying(page);
    });
    await test.step('When the sign-in is about to run out', async () => {
      await page.clock.fastForward('59:00');
    });
    await test.step('Then it pauses', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      pausedAt = await page.getByTestId('player-video').evaluate((v) => v.currentTime);
    });
    await test.step('And play with the PIN shows Google\'s sign-in again, and it plays on from where it paused', async () => {
      await startPlaying(page);
      expect(await google.signIns()).toBe(2);
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBeGreaterThanOrEqual(pausedAt);
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

  test.fixme('Scenario: a streamed video can be hidden from this device; it stays in Google Drive', async ({ page, pinSet }) => {
    // Nothing of a streamed video is stored, so there is nothing to remove:
    // "Hide" only changes what this device shows. "Remove" is for stored videos
    // and deletes the copy on the device (remove-video.spec.js).
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed and settings is unlocked', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
      await page.getByTestId('settings-button').tap();
      await enterPin(page, PIN);
    });
    await test.step('Then a streamed video offers "Hide", not "Remove"', async () => {
      const item = page.getByTestId('settings-video-item').filter({ hasText: 'tiny' });
      await expect(item.getByTestId('hide-video-button')).toBeVisible();
      await expect(item.getByTestId('remove-video-button')).toHaveCount(0);
    });
    await test.step('When I hide "tiny"', async () => {
      await page.getByTestId('settings-video-item').filter({ hasText: 'tiny' })
        .getByTestId('hide-video-button').tap();
    });
    await test.step('Then only "medium" is listed, and Google Drive was only ever read', async () => {
      await page.getByTestId('screen-settings').getByTestId('back-button').tap();
      await expect(page.getByTestId('library-item')).toHaveCount(1);
      await expect(page.getByTestId('library-item').filter({ hasText: 'medium' })).toBeVisible();
      expect(google.requestsOtherThanReads()).toBe(0);
    });
  });

  test.fixme('Scenario: a hidden video can be added again from Google Drive', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" was streamed and then hidden', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo');
      await page.getByTestId('settings-button').tap();
      await enterPin(page, PIN);
      await page.getByTestId('settings-video-item').filter({ hasText: 'tiny' })
        .getByTestId('hide-video-button').tap();
      await page.getByTestId('screen-settings').getByTestId('back-button').tap();
    });
    await test.step('When I add "tiny.kidsvideo" from Google Drive again', async () => {
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then it is listed again', async () => {
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toHaveAttribute('data-plays-from', 'drive');
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
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny".');
    });
  });
});
