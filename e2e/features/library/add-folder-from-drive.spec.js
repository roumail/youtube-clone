// Feature: Add a whole folder from Google Drive — in Google's Picker a folder
// can be picked too (Google's picker on the iPad takes one item at a time, and a
// series folder can hold many episodes). Every .kidsvideo in it, and in its
// subfolders, is added as streamed, one after another; titles already in the
// catalogue are skipped. Listing a folder needs the drive.readonly permission
// (see "Setting up Google Drive" in README.md); with drive.file alone Google
// shows the app nothing inside a picked folder.
// Replaces "a folder can only be opened in the Picker, not picked" in
// add-from-drive.spec.js, which is removed when this is built.
// Google is faked at the network boundary: fakeGoogle's third argument maps a
// folder path to the files in it. Not @ipad, for the same reason as
// add-from-drive.spec.js.
import {
  test, expect, goto, enterPin, startPlaying, fixtureContainer, fakeGoogle, PIN,
} from '../../support.js';

const episodes = {
  'Show - S01E01 - First.kidsvideo': fixtureContainer('Show - S01E01 - First'),
  'Show - S01E02 - Second.kidsvideo': fixtureContainer('Show - S01E02 - Second'),
  'Show - S01E03.kidsvideo': fixtureContainer('Show - S01E03'),
  'Show - S01E10 - Tenth.kidsvideo': fixtureContainer('Show - S01E10 - Tenth'),
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'notes.txt': fixtureContainer('tiny'),
};

// The shelf: a "Show" folder with a season subfolder, and an empty folder.
const folders = {
  Show: ['Show - S01E01 - First.kidsvideo', 'Show - S01E02 - Second.kidsvideo', 'notes.txt'],
  'Show/Season 1 extras': ['Show - S01E03.kidsvideo', 'Show - S01E10 - Tenth.kidsvideo'],
  Empty: [],
};

async function addFromDrive(page, google, ...names) {
  await google.willPick(...names);
  await page.getByTestId('add-from-drive-button').click();
  await enterPin(page, PIN);
}

test.describe('Feature: Add a whole folder from Google Drive', () => {
  test.fixme('Scenario: picking a folder adds every .kidsvideo in it and its subfolders, as streamed', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then its 4 episodes are added, from the folder and its subfolder, and the other file is left out', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added 4 of 4 videos from "Show".');
      await expect(page.getByTestId('series-item').filter({ hasText: 'Show' })).toContainText('4 episodes');
    });
    await test.step('And they are streamed, reading only their start', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await expect(page.getByTestId('episode-item').first()).toHaveAttribute('data-plays-from', 'drive');
    });
  });

  test.fixme('Scenario: an episode added from a folder plays after the PIN', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" was added', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('When I open its first episode and play with the PIN', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await page.getByTestId('episode-item').first().tap();
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
      await startPlaying(page);
    });
    await test.step('Then it plays', async () => {
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'playing');
    });
  });

  test.fixme('Scenario: adding a folder again adds only what is new, and says how many were already there', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given "Show - S01E01 - First" is already in the catalogue', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show - S01E01 - First.kidsvideo');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then the other 3 are added, and the one already there is skipped, not an error', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added 3 of 4 videos from "Show"; 1 was already in the library.');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
  });

  test.fixme('Scenario: a folder with no .kidsvideo in it says so and adds nothing', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I pick the folder "Empty"', async () => {
      await addFromDrive(page, google, 'Empty');
    });
    await test.step('Then it says the folder has no .kidsvideo files, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('There are no .kidsvideo files in "Empty".');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test.fixme('Scenario: a folder and a file picked together are both added', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I pick the folder "Show" and the file "tiny.kidsvideo" together', async () => {
      await addFromDrive(page, google, 'Show', 'tiny.kidsvideo');
    });
    await test.step('Then all 5 are added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added 5 of 5 videos.');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test.fixme('Scenario: a video in the folder that cannot be added is named, and the rest are added', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given "Show - S01E02 - Second.kidsvideo" in the folder can no longer be read', async () => {
      await goto(page, '#/library');
      google.deny('Show - S01E02 - Second.kidsvideo');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then the other 3 are added, and the summary names the one that failed', async () => {
      await expect(page.getByTestId('import-status')).toContainText('Added 3 of 4 videos from "Show".');
      await expect(page.getByTestId('import-status')).toContainText('Show - S01E02 - Second (no access to "Show - S01E02 - Second.kidsvideo" in Google Drive)');
    });
  });

  test.fixme('Scenario: if the folder cannot be listed, it says so and adds nothing', async ({ page, pinSet }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the connection to Google Drive drops when the folder is listed', async () => {
      await goto(page, '#/library');
      google.dropConnection('Show');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then it says the connection was lost, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Couldn\'t add the folder "Show": the connection to Google Drive was lost');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test.fixme('Scenario: an added episode keeps working after the hour, through the usual sign-in', async ({ page, pinSet }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" was added, and an hour has passed', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await page.clock.fastForward('01:00:00');
    });
    await test.step('When I open an episode and play with the PIN', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await page.getByTestId('episode-item').first().tap();
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
      await startPlaying(page);
    });
    await test.step('Then it signed in again on the opening tap, and plays', async () => {
      expect(await google.signIns()).toBe(2);
    });
  });
});
