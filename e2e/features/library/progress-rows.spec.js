// Feature: One row per add or download — every add (picked files, from Google
// Drive, a folder) and every download shows its own row in the library: its
// message, its progress and, for a download, its own Cancel. Several can run
// at once without overwriting each other. A finished row clears itself after a
// while; a row that failed stays longer, so it can be read.
// A row is data-testid="import-status" (data-import: storing, done, error or
// cancelled); its progress bar and Cancel are inside it. With nothing running
// or recently finished there is no row.
// Google is faked at the network boundary. Not @ipad, for the same reason as
// add-from-drive.spec.js.
import { test, expect, goto, fixtureContainer, fakeGoogle, tapContinue, signInDue } from '../../support.js';

const shelf = () => ({
  'Show - S01E01 - First.kidsvideo': fixtureContainer('Show - S01E01 - First'),
  'Show - S01E02 - Second.kidsvideo': fixtureContainer('Show - S01E02 - Second'),
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
});
const folders = { Show: ['Show - S01E01 - First.kidsvideo', 'Show - S01E02 - Second.kidsvideo'] };

const rows = (page) => page.getByTestId('import-status');
const row = (page, text) => rows(page).filter({ hasText: text });
const item = (page, title) => page.getByTestId('library-item').filter({ hasText: title });

// After Face ID; the first time, the Google sign-in is due, so "Continue" is
// tapped for it (unlock.spec.js).
async function addFromDrive(page, google, ...names) {
  await google.willPick(...names);
  const signingIn = await signInDue(page);
  await page.getByTestId('add-from-drive-button').click();
  if (signingIn) await tapContinue(page);
}

// After Face ID; signed in already (by the add), so no "Continue".
async function download(page, title) {
  await item(page, title).getByTestId('download-button').tap();
}

test.describe('Feature: One row per add or download', () => {
  test('Scenario: with nothing added or downloaded, there is no row', async ({ page, setUp }) => {
    await test.step('Given the library is shown', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then there is no row', async () => {
      await expect(rows(page)).toHaveCount(0);
    });
  });

  test('Scenario: two adds from Google Drive at once each get their own row', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shelf(), folders);
    let release;
    await test.step('Given the folder "Show" is being added', async () => {
      await goto(page, '#/library');
      release = google.holdReads('Show - S01E01 - First.kidsvideo');
      await addFromDrive(page, google, 'Show');
      await page.getByTestId('drive-choose-add').click(); // all of the folder's list
      await expect(row(page, 'Adding 1 of 2')).toHaveAttribute('data-import', 'storing');
    });
    await test.step('When I add "tiny" from Google Drive meanwhile', async () => {
      await addFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then "tiny" has its own row, and the folder\'s row still shows its progress', async () => {
      await expect(row(page, 'Added "tiny".')).toHaveAttribute('data-import', 'done');
      await expect(row(page, 'Adding 1 of 2')).toHaveAttribute('data-import', 'storing');
      await expect(rows(page)).toHaveCount(2);
    });
    await test.step('And when the folder is done, its row says so', async () => {
      release();
      await expect(row(page, 'Added 2 of 2 videos from "Show".')).toHaveAttribute('data-import', 'done');
      await expect(row(page, 'Added "tiny".')).toBeVisible();
    });
  });

  test('Scenario: an add and a download at once each get their own row', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shelf());
    let release;
    await test.step('Given "medium" is streamed and being downloaded', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'medium.kidsvideo');
      await expect(row(page, 'Added "medium".')).toBeVisible();
      release = google.holdReads('medium.kidsvideo');
      await download(page, 'medium');
      await expect(row(page, 'Downloading "medium"')).toHaveAttribute('data-import', 'storing');
    });
    await test.step('When I add "tiny" from Google Drive meanwhile', async () => {
      await addFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('Then "tiny" has its own row, and the download\'s row still shows its progress', async () => {
      await expect(row(page, 'Added "tiny".')).toHaveAttribute('data-import', 'done');
      await expect(row(page, 'Downloading "medium"')).toHaveAttribute('data-import', 'storing');
    });
    await test.step('And when the download is done, its row says so', async () => {
      release();
      await expect(row(page, 'Downloaded "medium".')).toHaveAttribute('data-import', 'done');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
  });

  test('Scenario: a finished row clears itself after 10 seconds', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shelf());
    await test.step('Given "tiny" was just added from Google Drive', async () => {
      await goto(page, '#/library');
      await addFromDrive(page, google, 'tiny.kidsvideo');
      await expect(row(page, 'Added "tiny".')).toHaveAttribute('data-import', 'done');
    });
    await test.step('When 9 seconds have passed, its row is still there', async () => {
      await page.clock.runFor(9_000);
      await expect(row(page, 'Added "tiny".')).toBeVisible();
    });
    await test.step('Then after 10 seconds it is gone', async () => {
      await page.clock.runFor(1_000);
      await expect(rows(page)).toHaveCount(0);
    });
  });

  test('Scenario: a row that failed clears itself after a minute', async ({ page, setUp }) => {
    await page.clock.install();
    const google = await fakeGoogle(page, shelf());
    await test.step('Given adding "tiny" from Google Drive just failed', async () => {
      await goto(page, '#/library');
      google.dropConnection('tiny.kidsvideo');
      await addFromDrive(page, google, 'tiny.kidsvideo');
      await expect(row(page, 'the connection to Google Drive was lost')).toHaveAttribute('data-import', 'error');
    });
    await test.step('When 59 seconds have passed, its row is still there', async () => {
      await page.clock.runFor(59_000);
      await expect(rows(page)).toHaveCount(1);
    });
    await test.step('Then after a minute it is gone', async () => {
      await page.clock.runFor(1_000);
      await expect(rows(page)).toHaveCount(0);
    });
  });
});
