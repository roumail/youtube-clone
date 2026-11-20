// Feature: Add from Google Drive — behind the PIN, sign in to Google, pick
// .kidsvideo files in Google's Picker; they are downloaded and stored on the
// device. The app only reads the files picked (drive.file): files only, several
// at a time; a folder can't be picked (Google gives no access to what's in a
// picked folder under drive.file), it only opens. Google is faked
// at the network boundary (fakeGoogle in e2e/support.js). Not @ipad: once the
// service worker controls the page, Playwright's WebKit can't intercept the
// Drive requests, so they would reach the real Google.
import {
  test, expect, goto, enterPin, openVideo, startPlaying, fixtureContainer, fixtureParts, fakeGoogle, freeSpace,
  containerSize, PIN, WRONG_PIN,
} from '../../support.js';

const shared = () => ({
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
  'poster.jpg': fixtureParts('tiny')[3],
});

async function addFromDrive(page) {
  await page.getByTestId('add-from-drive-button').click();
  await enterPin(page, PIN);
}

test.describe('Feature: Add from Google Drive', () => {
  test('Scenario: adding from Google Drive needs the PIN', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the library is shown', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap "Add from Google Drive" and enter a wrong PIN', async () => {
      await page.getByTestId('add-from-drive-button').click();
      await enterPin(page, WRONG_PIN);
    });
    await test.step('Then the prompt says it is wrong, and Google sign-in was never asked', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
      expect(await google.signIns()).toBe(0);
    });
  });

  test('Scenario: sign in, pick "tiny.kidsvideo", and it is added and plays', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
      await google.willPick('tiny.kidsvideo');
    });
    await test.step('When I tap "Add from Google Drive", enter the PIN, sign in and pick "tiny.kidsvideo"', async () => {
      await addFromDrive(page);
    });
    await test.step('Then "tiny" is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny".');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
    await test.step('And it plays after the PIN', async () => {
      await openVideo(page, 'tiny');
      await startPlaying(page);
    });
  });

  test('Scenario: picking several videos adds them one after another', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
      await google.willPick('tiny.kidsvideo', 'medium.kidsvideo');
    });
    await test.step('When I pick "tiny.kidsvideo" and "medium.kidsvideo" in the Picker', async () => {
      await addFromDrive(page);
    });
    await test.step('Then both are added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added 2 of 2 videos.');
      await expect(page.getByTestId('library-item')).toHaveCount(2);
    });
  });

  test('Scenario: a second add in the same session does not ask to sign in again', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given I signed in and added "tiny"', async () => {
      await goto(page, '#/library');
      await google.willPick('tiny.kidsvideo');
      await addFromDrive(page);
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny".');
    });
    await test.step('When I add "medium.kidsvideo" from Google Drive', async () => {
      await google.willPick('medium.kidsvideo');
      await addFromDrive(page);
    });
    await test.step('Then it is added, and I signed in only once', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added "medium".');
      expect(await google.signIns()).toBe(1);
    });
  });

  test('Scenario: cancelling the Google sign-in adds nothing', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
      await google.signInWillBeCancelled();
    });
    await test.step('When I tap "Add from Google Drive", enter the PIN and close the Google sign-in', async () => {
      await addFromDrive(page);
    });
    await test.step('Then nothing is added and nothing was downloaded', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'idle');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      expect(google.bytesRead()).toBe(0);
    });
  });

  test('Scenario: a folder can only be opened in the Picker, not picked, so it adds nothing', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared(), ['Kipper the Dog']);
    await test.step('Given the library is empty and Google Drive has a folder "Kipper the Dog"', async () => {
      await goto(page, '#/library');
      await google.willPick('Kipper the Dog');
    });
    await test.step('When I try to pick the folder "Kipper the Dog" and close the Picker', async () => {
      await addFromDrive(page);
      await expect.poll(() => google.signIns()).toBe(1);
    });
    await test.step('Then nothing is added and nothing was downloaded', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'idle');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      expect(google.bytesRead()).toBe(0);
    });
  });

  test('Scenario: closing the Picker without picking adds nothing', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I sign in and close the Picker without picking', async () => {
      await addFromDrive(page);
      await expect.poll(() => google.signIns()).toBe(1);
    });
    await test.step('Then nothing is added and nothing was downloaded', async () => {
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'idle');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      expect(google.bytesRead()).toBe(0);
    });
  });

  test('Scenario: a picked file that is not a .kidsvideo is refused by name', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the library is empty', async () => {
      await goto(page, '#/library');
      await google.willPick('poster.jpg');
    });
    await test.step('When I pick "poster.jpg"', async () => {
      await addFromDrive(page);
    });
    await test.step('Then it is refused by name, nothing is added and nothing was downloaded', async () => {
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: poster.jpg isn't a .kidsvideo file");
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      expect(google.bytesRead()).toBe(0);
    });
  });

  test('Scenario: a video the account may not read is refused, and nothing is added', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny.kidsvideo" is no longer shared with the account', async () => {
      await goto(page, '#/library');
      google.deny('tiny.kidsvideo');
      await google.willPick('tiny.kidsvideo');
    });
    await test.step('When I pick it', async () => {
      await addFromDrive(page);
    });
    await test.step('Then the import says Google Drive gave no access, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: no access to \"tiny.kidsvideo\" in Google Drive");
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: if the connection drops while adding, the import says so and nothing is left behind', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the connection to Google Drive drops while "medium.kidsvideo" downloads', async () => {
      await goto(page, '#/library');
      google.dropConnection('medium.kidsvideo');
      await google.willPick('medium.kidsvideo');
    });
    await test.step('When I pick it', async () => {
      await addFromDrive(page);
    });
    await test.step('Then the import says the connection was lost', async () => {
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: the connection to Google Drive was lost");
    });
    await test.step('And nothing is left behind, even after a reload', async () => {
      await page.reload();
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: a video already in the library is refused before downloading', async ({ page, pinSet, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "tiny" is already in the library', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await google.willPick('tiny.kidsvideo');
    });
    await test.step('When I pick "tiny.kidsvideo" again', async () => {
      await addFromDrive(page);
    });
    await test.step('Then it is refused as already in the library, after reading only the kidsvideo.json at its start', async () => {
      await expect(page.getByTestId('import-status')).toHaveText("Couldn't add the video: \"tiny\" is already in the library");
      expect(google.bytesRead('tiny.kidsvideo')).toBeLessThanOrEqual(1024);
    });
  });

  test('Scenario: a video that does not fit is refused before downloading', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given there is room for only half of "tiny"', async () => {
      await freeSpace(page, Math.floor(containerSize('tiny') / 2));
      await goto(page, '#/library');
      await google.willPick('tiny.kidsvideo');
    });
    await test.step('When I pick "tiny.kidsvideo"', async () => {
      await addFromDrive(page);
    });
    await test.step('Then it is refused for lack of space, using the size Drive reports, after reading only the kidsvideo.json at its start', async () => {
      await expect(page.getByTestId('import-status')).toContainText(/not enough space on this device \("tiny" needs [\d.]+ MB, [\d.]+ MB is free\)/);
      expect(google.bytesRead('tiny.kidsvideo')).toBeLessThanOrEqual(1024);
    });
  });

  test('Scenario: an hour later, adding from Google Drive asks to sign in again', async ({ page, pinSet }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shared());
    await test.step('Given I signed in and added "tiny"', async () => {
      await goto(page, '#/library');
      await google.willPick('tiny.kidsvideo');
      await addFromDrive(page);
      await expect(page.getByTestId('import-status')).toHaveText('Added "tiny".');
    });
    await test.step('When an hour passes and I add "medium.kidsvideo" from Google Drive', async () => {
      await page.clock.fastForward('01:00:00');
      await google.willPick('medium.kidsvideo');
      await addFromDrive(page);
    });
    await test.step('Then I am asked to sign in again, and it is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added "medium".');
      expect(await google.signIns()).toBe(2);
    });
  });
});
