// Feature: Videos gone from Google Drive — a streamed video whose file was
// deleted from Google Drive, or is in Drive's trash, leaves the library by
// itself, as if hidden. The app can only ask Drive with a Google sign-in, and
// a sign-in needs a tap (stream-from-drive.spec.js), so it asks right after
// each sign-in, about every streamed video at once; and when opening a
// streamed video finds it gone. Nothing is checked at start-up, so no tile
// disappears from under a finger. If the video being opened is gone, there is
// no error: the player closes and the library says it is no longer in Google
// Drive; the others go quietly. A downloaded video stays: it plays without
// Drive. When Drive can't answer (no connection, any other error), nothing
// is hidden. A hidden video can be added again (stream-from-drive.spec.js).
// Google is faked at the network boundary (fakeGoogle in e2e/support.js).
// Not @ipad, for the same reason as add-from-drive.spec.js.
import {
  test, expect, goto, fixtureContainer, fakeGoogle, playerState, tapContinue, signInDue, downloadVideos,
} from '../../support.js';

const shared = () => ({
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
});

async function streamFromDrive(page, google, ...names) {
  await google.willPick(...names);
  const signingIn = await signInDue(page);
  await page.getByTestId('add-from-drive-button').click();
  if (signingIn) await tapContinue(page);
  await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', /done|error/);
}

const item = (page, title) => page.getByTestId('library-item').filter({ hasText: title });
const noLonger = (page) => page.getByTestId('import-status').filter({ hasText: 'no longer in Google Drive' });

// Streams "tiny" and "medium", then lets the sign-in run out (and the rows clear).
async function streamBothAnHourAgo(page, google) {
  await goto(page, '#/library');
  await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
  await page.clock.fastForward('01:00:00');
}

test.describe('Feature: Videos gone from Google Drive', () => {
  test('Scenario: opening a video deleted from Google Drive goes back to the library, which says so; other deleted videos go too', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed, and an hour has passed', async () => {
      await streamBothAnHourAgo(page, google);
    });
    await test.step('When both are deleted from Google Drive, and I open "tiny"', async () => {
      google.delete('tiny.kidsvideo');
      google.delete('medium.kidsvideo');
      await item(page, 'tiny').tap();
    });
    await test.step('Then, after signing in, I am back in the library, which says "tiny" is no longer in Google Drive', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(noLonger(page)).toHaveText(['"tiny" is no longer in Google Drive.']);
      expect(await google.signIns()).toBe(2);
    });
    await test.step('And neither "tiny" nor "medium" is listed, and no error was shown', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(0);
      await expect(playerState(page)).not.toHaveAttribute('data-state', 'error');
    });
  });

  test('Scenario: opening a deleted video while still signed in also goes back to the library, which says so', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed (signed in)', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
    });
    await test.step('When "tiny" is deleted from Google Drive, and I open it', async () => {
      google.delete('tiny.kidsvideo');
      await item(page, 'tiny').tap();
    });
    await test.step('Then I am back in the library, which says "tiny" is no longer in Google Drive', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(noLonger(page)).toHaveText(['"tiny" is no longer in Google Drive.']);
    });
    await test.step('And only "medium" is listed', async () => {
      await expect(page.getByTestId('library-item')).toHaveText([/medium/]);
    });
  });

  test('Scenario: a video in Google Drive\'s trash leaves the library at the next sign-in, quietly', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed, and an hour has passed', async () => {
      await streamBothAnHourAgo(page, google);
    });
    await test.step('When "medium" is moved to Google Drive\'s trash, and I open "tiny"', async () => {
      google.trash('medium.kidsvideo');
      await item(page, 'tiny').tap();
    });
    await test.step('Then "tiny" opens as usual', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    });
    await test.step('And back in the library, only "tiny" is listed, with no message', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await expect(page.getByTestId('library-item')).toHaveText([/tiny/]);
      await expect(noLonger(page)).toHaveCount(0);
    });
  });

  test('Scenario: "Add from Google Drive" takes deleted videos off the library first', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed, and an hour has passed', async () => {
      await streamBothAnHourAgo(page, google);
    });
    await test.step('When "medium" is deleted from Google Drive, and I tap "Add from Google Drive", sign in and close the picker', async () => {
      google.delete('medium.kidsvideo');
      await google.willPick();
      await page.getByTestId('add-from-drive-button').click();
      await tapContinue(page);
    });
    await test.step('Then only "tiny" is listed', async () => {
      await expect(page.getByTestId('library-item')).toHaveText([/tiny/]);
      expect(await google.signIns()).toBe(2);
    });
  });

  test('Scenario: a downloaded video stays when its file is deleted from Google Drive', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed and "medium" is downloaded, and an hour has passed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
      await downloadVideos(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
      await page.clock.fastForward('01:00:00');
    });
    await test.step('When "medium" is deleted from Google Drive, and I open "tiny" (signing in)', async () => {
      google.delete('medium.kidsvideo');
      await item(page, 'tiny').tap();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    });
    await test.step('Then back in the library, "medium" is still listed, downloaded', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
  });

  test('Scenario: when Google Drive can\'t be reached for a video, it stays', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" and "medium" are streamed, and an hour has passed', async () => {
      await streamBothAnHourAgo(page, google);
    });
    await test.step('When the connection drops for "medium", and I open "tiny" (signing in)', async () => {
      google.dropConnection('medium.kidsvideo');
      await item(page, 'tiny').tap();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    });
    await test.step('Then back in the library, both are still listed', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').click();
      await expect(page.getByTestId('library-item')).toHaveCount(2);
    });
  });
});
