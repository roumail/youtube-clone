// Feature: Add from a folder in Google Drive — in Google's Picker a folder can
// be picked too (Google's picker on the iPad takes one item at a time, and a
// series folder can hold many episodes). The app then lists every .kidsvideo
// in it, and in its subfolders, in title order, each with a box to tick: all
// new ones start ticked; titles already in the catalogue are shown, greyed out
// and can't be ticked. "Untick all" / "Tick all" switches every new one. "Add
// N" adds the ticked ones as streamed, one after another; Cancel adds nothing.
// Files picked together with a folder join its list. Listing a folder needs the drive.readonly permission
// (see "Setting up Google Drive" in README.md); with drive.file alone Google
// shows the app nothing inside a picked folder.
// Replaces "a folder can only be opened in the Picker, not picked" in
// add-from-drive.spec.js, which is removed when this is built.
// Google is faked at the network boundary: fakeGoogle's third argument maps a
// folder path to the files in it. Not @ipad, for the same reason as
// add-from-drive.spec.js.
import {
  test, expect, goto, startPlaying, fixtureContainer, fakeGoogle, tapContinue, signInDue,
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

// Pick in Google Drive after Face ID; the first time, the sign-in is due, so
// "Continue" is tapped for it (unlock.spec.js).
async function addFromDrive(page, google, ...names) {
  await google.willPick(...names);
  const signingIn = await signInDue(page);
  await page.getByTestId('add-from-drive-button').click();
  if (signingIn) await tapContinue(page);
}

const chooser = (page) => page.getByTestId('drive-choose');
const choice = (page, title) => page.getByTestId('drive-choose-item').filter({ hasText: title });
const box = (page, title) => choice(page, title).getByTestId('drive-choose-box');
const addButton = (page) => page.getByTestId('drive-choose-add');

// Pick a folder and add everything new in it (as listed, all ticked).
async function addFolder(page, google, ...names) {
  await addFromDrive(page, google, ...names);
  await addButton(page).click();
}

test.describe('Feature: Add from a folder in Google Drive', () => {
  test('Scenario: picking a folder lists every .kidsvideo in it and its subfolders, all ticked', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then its 4 episodes are listed in title order, from the folder and its subfolder, all ticked, and the other file is left out', async () => {
      await expect(chooser(page)).toBeVisible();
      await expect(page.getByTestId('drive-choose-item')).toHaveText([
        /Show - S01E01 - First/, /Show - S01E02 - Second/, /Show - S01E03/, /Show - S01E10 - Tenth/,
      ]);
      for (const b of await page.getByTestId('drive-choose-box').all()) await expect(b).toBeChecked();
      await expect(addButton(page)).toHaveText('Add 4');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
    await test.step('When I tap "Add 4"', async () => {
      await addButton(page).click();
    });
    await test.step('Then the 4 episodes are added', async () => {
      await expect(chooser(page)).toBeHidden();
      await expect(page.getByTestId('import-status')).toHaveText('Added 4 of 4 videos from "Show".');
      await expect(page.getByTestId('series-item').filter({ hasText: 'Show' })).toContainText('4 episodes');
    });
    await test.step('And they are streamed, reading only their start', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await expect(page.getByTestId('episode-item').first()).toHaveAttribute('data-plays-from', 'drive');
    });
  });

  test('Scenario: only the ticked videos are added', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" is listed', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show');
      await expect(chooser(page)).toBeVisible();
    });
    await test.step('When I untick "S01E02" and "S01E10", and tap "Add 2"', async () => {
      await box(page, 'S01E02').uncheck();
      await box(page, 'S01E10').uncheck();
      await expect(addButton(page)).toHaveText('Add 2');
      await addButton(page).click();
    });
    await test.step('Then only "S01E01" and "S01E03" are added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added 2 of 2 videos from "Show".');
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await expect(page.getByTestId('episode-item')).toHaveText([/S01E01/, /S01E03/]);
    });
  });

  test('Scenario: "Untick all", then ticking one, adds just that one', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" is listed', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show');
    });
    await test.step('When I tap "Untick all"', async () => {
      await page.getByTestId('drive-choose-toggle').click();
    });
    await test.step('Then nothing is ticked, "Add" can\'t be tapped, and the switch reads "Tick all"', async () => {
      for (const b of await page.getByTestId('drive-choose-box').all()) await expect(b).not.toBeChecked();
      await expect(addButton(page)).toBeDisabled();
      await expect(page.getByTestId('drive-choose-toggle')).toHaveText('Tick all');
    });
    await test.step('When I tick "S01E03" and tap "Add 1"', async () => {
      await box(page, 'S01E03').check();
      await expect(addButton(page)).toHaveText('Add 1');
      await addButton(page).click();
    });
    await test.step('Then just that one is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Added 1 of 1 videos from "Show".');
      await expect(page.getByTestId('library-item').or(page.getByTestId('series-item'))).toHaveCount(1);
    });
  });

  test('Scenario: Cancel adds nothing', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" is listed', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show');
      await expect(chooser(page)).toBeVisible();
    });
    await test.step('When I tap Cancel', async () => {
      await page.getByTestId('drive-choose-cancel').click();
    });
    await test.step('Then the list closes, nothing is added, and nothing of the videos was read', async () => {
      await expect(chooser(page)).toBeHidden();
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
      await expect(page.getByTestId('import-status')).toHaveCount(0);
      expect(google.bytesRead()).toBe(0);
    });
  });

  test('Scenario: an episode added from a folder plays after Face ID', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" was added', async () => {
      await goto(page, '#/library');
      await addFolder(page, google, 'Show');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('When I open its first episode and play with Face ID', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await page.getByTestId('episode-item').first().tap();
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
      await startPlaying(page);
    });
    await test.step('Then it plays', async () => {
      await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'playing');
    });
  });

  test('Scenario: titles already in the catalogue are listed greyed out, and only what is new is added', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given "Show - S01E01 - First" is already in the catalogue', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'Show - S01E01 - First.kidsvideo');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then "S01E01" is listed as in the library, unticked, and can\'t be ticked; the other 3 are ticked', async () => {
      await expect(choice(page, 'S01E01')).toHaveAttribute('data-state', 'in-library');
      await expect(box(page, 'S01E01')).not.toBeChecked();
      await expect(box(page, 'S01E01')).toBeDisabled();
      await expect(addButton(page)).toHaveText('Add 3');
    });
    await test.step('And "Add 3" adds the other 3, saying the one already there was left out', async () => {
      await addButton(page).click();
      const row = page.getByTestId('import-status').filter({ hasText: 'from "Show"' });
      await expect(row).toHaveText('Added 3 of 3 videos from "Show" (1 already in the library).');
      await expect(row).toHaveAttribute('data-import', 'done');
    });
  });

  test('Scenario: a folder with no .kidsvideo in it says so and adds nothing', async ({ page, setUp }) => {
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

  test('Scenario: a folder and a file picked together are both added', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the catalogue is empty', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I pick the folder "Show" and the file "tiny.kidsvideo" together', async () => {
      await addFromDrive(page, google, 'Show', 'tiny.kidsvideo');
    });
    await test.step('Then all 5 are listed together, and "Add 5" adds them', async () => {
      await expect(page.getByTestId('drive-choose-item')).toHaveCount(5);
      await addButton(page).click();
      await expect(page.getByTestId('import-status')).toHaveText('Added 5 of 5 videos.');
      await expect(page.getByTestId('library-item').filter({ hasText: 'tiny' })).toBeVisible();
    });
  });

  test('Scenario: a video in the folder that cannot be added is named, and the rest are added', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given "Show - S01E02 - Second.kidsvideo" in the folder can no longer be read', async () => {
      await goto(page, '#/library');
      google.deny('Show - S01E02 - Second.kidsvideo');
    });
    await test.step('When I pick the folder "Show" and add all 4', async () => {
      await addFolder(page, google, 'Show');
    });
    await test.step('Then the other 3 are added, and the summary names the one that failed', async () => {
      await expect(page.getByTestId('import-status')).toContainText('Added 3 of 4 videos from "Show".');
      await expect(page.getByTestId('import-status')).toContainText('Show - S01E02 - Second (no access to "Show - S01E02 - Second.kidsvideo" in Google Drive)');
    });
  });

  test('Scenario: a folder no longer shared says so and adds nothing', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" is no longer shared with the account', async () => {
      await goto(page, '#/library');
      google.deny('Show');
    });
    await test.step('When I pick the folder "Show"', async () => {
      await addFromDrive(page, google, 'Show');
    });
    await test.step('Then it says there is no access to it, and nothing is added', async () => {
      await expect(page.getByTestId('import-status')).toHaveText('Couldn\'t add the folder "Show": no access to "Show" in Google Drive');
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'empty');
    });
  });

  test('Scenario: if the folder cannot be listed, it says so and adds nothing', async ({ page, setUp }) => {
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

  test('Scenario: an added episode keeps working after the hour, through the usual sign-in', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, episodes, folders);
    await test.step('Given the folder "Show" was added, and an hour has passed', async () => {
      await goto(page, '#/library');
      await addFolder(page, google, 'Show');
      await expect(page.getByTestId('import-status')).toHaveAttribute('data-import', 'done');
      await page.clock.fastForward('01:00:00');
    });
    await test.step('When I open an episode and play with Face ID', async () => {
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
