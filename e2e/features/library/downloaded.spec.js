// Feature: What is downloaded, at a glance — a downloaded video's tile carries
// a "Downloaded" badge, and a series tile says how many of its episodes are
// downloaded. The "Downloaded" toggle next to search keeps only what plays with
// no connection (stored videos and downloaded ones); it is not saved. With no
// connection, streamed videos that aren't downloaded are dimmed and a tap does
// not open them (a series is dimmed when none of its episodes would play).
// Downloading itself is in download.spec.js.
// Google is faked at the network boundary.
// Not @ipad, for the same reason as add-from-drive.spec.js.
import {
  test, expect, goto, fixtureContainer, fakeGoogle, tapContinue, signInDue, downloadVideos,
} from '../../support.js';

const shared = () => ({
  'tiny.kidsvideo': fixtureContainer('tiny'),
  'medium.kidsvideo': fixtureContainer('medium'),
  'Show - S01E01 - First.kidsvideo': fixtureContainer('Show - S01E01 - First'),
  'Show - S01E02 - Second.kidsvideo': fixtureContainer('Show - S01E02 - Second'),
});

async function streamFromDrive(page, google, ...names) {
  await google.willPick(...names);
  const signingIn = await signInDue(page);
  await page.getByTestId('add-from-drive-button').click();
  if (signingIn) await tapContinue(page);
  // Each picked file gets its own row; wait until all of them have finished.
  await expect(page.getByTestId('import-status')).toHaveCount(names.length);
  await expect(page.locator('[data-testid="import-status"][data-import="storing"]')).toHaveCount(0);
}

const item = (page, title) => page.getByTestId('library-item').filter({ hasText: title });
const series = (page) => page.getByTestId('series-item').filter({ hasText: 'Show' });

test.describe('Feature: What is downloaded, at a glance', () => {
  test('Scenario: a downloaded video carries a "Downloaded" badge; others do not', async ({ page, setUp, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "Second" is stored, and "tiny" and "medium" are streamed', async () => {
      await goto(page, '#/library');
      await seedLibrary('Second');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
    });
    await test.step('When I download "medium"', async () => {
      await downloadVideos(page, 'medium');
    });
    await test.step('Then only "medium" carries the "Downloaded" badge', async () => {
      await expect(item(page, 'medium').getByTestId('downloaded-badge')).toHaveText('Downloaded');
      await expect(page.getByTestId('downloaded-badge')).toHaveCount(1);
    });
  });

  test('Scenario: a series tile says how many of its episodes are downloaded', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given the 2 episodes of "Show" are streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'Show - S01E01 - First.kidsvideo', 'Show - S01E02 - Second.kidsvideo');
      await expect(series(page)).toContainText('2 episodes');
      await expect(series(page)).not.toContainText('downloaded');
    });
    await test.step('When I open "Show" and download its first episode', async () => {
      await series(page).click();
      await downloadVideos(page, 'S01E01');
      await expect(page.getByTestId('episode-item').filter({ hasText: 'S01E01' }).getByTestId('downloaded-badge')).toBeVisible();
    });
    await test.step('Then back in the library, "Show" says "2 episodes · 1 downloaded"', async () => {
      await page.getByTestId('screen-series').getByTestId('back-button').click();
      await expect(series(page)).toContainText('2 episodes · 1 downloaded');
    });
  });

  test('Scenario: the "Downloaded" toggle keeps only what plays with no connection', async ({ page, setUp, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "Second" is stored, "tiny" and "medium" are streamed, and "medium" is downloaded', async () => {
      await goto(page, '#/library');
      await seedLibrary('Second');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'medium.kidsvideo');
      await downloadVideos(page, 'medium');
      await expect(item(page, 'medium')).toHaveAttribute('data-downloaded', 'true');
    });
    await test.step('When I tap "Downloaded"', async () => {
      await page.getByTestId('library-filter').tap();
    });
    await test.step('Then it is on, and only "medium" and "Second" are listed', async () => {
      await expect(page.getByTestId('library-filter')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('library-item')).toHaveText([/medium/, /Second/]);
    });
    await test.step('When I tap it again', async () => {
      await page.getByTestId('library-filter').tap();
    });
    await test.step('Then all 3 are listed again', async () => {
      await expect(page.getByTestId('library-filter')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByTestId('library-item')).toHaveCount(3);
    });
  });

  test('Scenario: with nothing downloaded, the "Downloaded" toggle says so', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given only "tiny" is streamed', async () => {
      await goto(page, '#/library');
      await streamFromDrive(page, google, 'tiny.kidsvideo');
    });
    await test.step('When I tap "Downloaded"', async () => {
      await page.getByTestId('library-filter').tap();
    });
    await test.step('Then nothing is listed, and it says nothing is downloaded yet', async () => {
      await expect(page.getByTestId('library-item')).toHaveCount(0);
      await expect(page.getByTestId('filter-empty')).toHaveText('Nothing downloaded yet.');
    });
  });

  test('Scenario: with no connection, streamed videos that would not play are dimmed and do not open', async ({ page, setUp, seedLibrary }) => {
    const google = await fakeGoogle(page, shared());
    await test.step('Given "Second" is stored, and "tiny" and the series "Show" are streamed', async () => {
      await goto(page, '#/library');
      await seedLibrary('Second');
      await streamFromDrive(page, google, 'tiny.kidsvideo', 'Show - S01E01 - First.kidsvideo');
    });
    await test.step('When the connection is lost', async () => {
      await page.context().setOffline(true);
    });
    await test.step('Then "tiny" and "Show" are dimmed, and "Second" is not', async () => {
      await expect(item(page, 'tiny')).toHaveAttribute('data-unavailable', 'true');
      await expect(series(page)).toHaveAttribute('data-unavailable', 'true');
      await expect(item(page, 'Second')).not.toHaveAttribute('data-unavailable', 'true');
    });
    await test.step('And tapping "tiny" does not open it', async () => {
      await item(page, 'tiny').tap();
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('screen-player')).toBeHidden();
    });
    await test.step('When the connection is back, nothing is dimmed', async () => {
      await page.context().setOffline(false);
      await expect(page.locator('[data-unavailable="true"]')).toHaveCount(0);
    });
  });
});
