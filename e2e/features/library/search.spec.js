// Feature: Search the library — a parent narrows the library by title.
// Search is flat: it also finds episodes inside a series (see below).
// Typing needs Face ID; clearing is free.
import { test, expect, goto, fakeGoogle, fixtureContainer, tapContinue, downloadVideos } from '../../support.js';

const search = (page) => page.getByTestId('search-input');
const items = (page) => page.getByTestId('library-item');
const seriesTiles = (page) => page.getByTestId('series-item');

async function unlockSearch(page) {
  await search(page).click();
  await expect(search(page)).toHaveAttribute('data-state', 'unlocked');
}

test.describe('Feature: Search the library', () => {
  test('Scenario: typing into search needs Face ID', async ({ page, setUp, seedLibrary, faceId }) => {
    await test.step('Given "tiny" and "medium" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
    });
    await test.step('Then the search field is locked and cannot be typed into', async () => {
      await expect(search(page)).toHaveAttribute('data-state', 'locked');
      await expect(search(page)).not.toBeEditable();
    });
    const before = await faceId.uses();
    await test.step('When I tap the search field and pass Face ID', async () => {
      await search(page).click();
    });
    await test.step('Then it unlocks, after Face ID', async () => {
      await expect(search(page)).toHaveAttribute('data-state', 'unlocked');
      expect(await faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: after Face ID, typing narrows the library by title', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given "tiny", "medium" and "episode-like" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium', 'episode-like');
    });
    await test.step('When I tap search, pass Face ID and type "TIN"', async () => {
      await unlockSearch(page);
      await expect(search(page)).toBeFocused();
      await page.keyboard.type('TIN');
    });
    await test.step('Then only videos whose title contains it (any case) are shown', async () => {
      await expect(items(page)).toHaveText([/tiny/]);
    });
  });

  test('Scenario: a series is found by its name, episodes in order', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given three episodes of "Show" and "tiny" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('Show - S01E10 - Tenth', 'tiny', 'Show - S01E02 - Second', 'Show - S01E01 - First');
    });
    await test.step('When I unlock search and type "show"', async () => {
      await unlockSearch(page);
      await page.keyboard.type('show');
    });
    await test.step('Then only the episodes are shown, in episode order', async () => {
      await expect(items(page)).toHaveText([/S01E01 - First/, /S01E02 - Second/, /S01E10 - Tenth/]);
    });
  });

  // Search is flat: it looks at every video's full title, including episodes
  // inside a series. Results are always single videos named in full
  // ("Show - S01E02 - Second"), never series tiles, so the same name at the
  // root and inside a series can be told apart. Each video is listed once, in
  // library order (by series or video name; a video named like a series just
  // before it; episodes in season/episode order).

  test('Scenario: an episode is found by its own name, shown on its own and named in full', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given three episodes of "Show" and "tiny" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('Show - S01E10 - Tenth', 'tiny', 'Show - S01E02 - Second', 'Show - S01E01 - First');
    });
    await test.step('When I unlock search and type "second", which is only in an episode\'s name', async () => {
      await unlockSearch(page);
      await page.keyboard.type('second');
    });
    await test.step('Then only that episode is shown, under its full title, and no series tile', async () => {
      await expect(items(page)).toHaveText(['Show - S01E02 - Second']);
      await expect(seriesTiles(page)).toHaveCount(0);
    });
    await test.step('And clearing the search shows "Show" as one series tile again', async () => {
      await page.getByTestId('search-clear').click();
      await expect(seriesTiles(page)).toHaveText([/Show/]);
    });
  });

  test('Scenario: a video named like a series is listed with the series\' episodes, itself first', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given a standalone video "Show", two episodes of the series "Show", and "tiny" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('Show - S01E02 - Second', 'tiny', 'Show', 'Show - S01E01 - First');
    });
    await test.step('When I unlock search and type "show"', async () => {
      await unlockSearch(page);
      await page.keyboard.type('show');
    });
    await test.step('Then the standalone "Show" comes first, then each episode, all named in full', async () => {
      await expect(items(page)).toHaveText(['Show', 'Show - S01E01 - First', 'Show - S01E02 - Second']);
      await expect(seriesTiles(page)).toHaveCount(0);
    });
  });

  test('Scenario: the same name in two series and on its own lists each video once', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given "Second" is stored on its own, and as an episode of "Show" and of "Garden"', async () => {
      await goto(page, '#/library');
      await seedLibrary('Show - S01E02 - Second', 'Second', 'Garden - S02E01 - Second', 'Show - S01E01 - First');
    });
    await test.step('When I unlock search and type "second"', async () => {
      await unlockSearch(page);
      await page.keyboard.type('second');
    });
    await test.step('Then all three are listed once each, in library order, named in full', async () => {
      await expect(items(page)).toHaveText(['Garden - S02E01 - Second', 'Second', 'Show - S01E02 - Second']);
    });
  });

  test('Scenario: each result opens its own video, and back returns to the results', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given a standalone "Show" and the series "Show" are stored, and I searched for "show"', async () => {
      await goto(page, '#/library');
      await seedLibrary('Show', 'Show - S01E01 - First', 'Show - S01E02 - Second');
      await unlockSearch(page);
      await page.keyboard.type('show');
      await expect(items(page)).toHaveCount(3);
    });
    for (const title of ['Show', 'Show - S01E02 - Second']) {
      await test.step(`When I tap the result "${title}"`, async () => {
        const result = items(page).filter({ hasText: new RegExp(`^${title}$`) }); // exact: not the other "Show…"
        const id = await result.getAttribute('data-video-id');
        await result.click();
        await test.step('Then that very video opens in the player, paused', async () => {
          await expect(page).toHaveURL((url) => url.hash === `#/player/${encodeURIComponent(id)}`);
          await expect(page.getByTestId('screen-player')).toHaveAttribute('data-state', 'paused');
        });
        await test.step('And back returns to the same search results', async () => {
          await page.getByTestId('screen-player').getByTestId('back-button').click();
          await expect(search(page)).toHaveValue('show');
          await expect(items(page)).toHaveText(['Show', 'Show - S01E01 - First', 'Show - S01E02 - Second']);
        });
      });
    }
  });

  test('Scenario: a streamed video that is also downloaded is listed once', async ({ page, setUp }) => {
    const google = await fakeGoogle(page, { 'medium.kidsvideo': fixtureContainer('medium') });
    await test.step('Given "medium" is streamed from Google Drive and downloaded', async () => {
      await goto(page, '#/library');
      await google.willPick('medium.kidsvideo');
      await page.getByTestId('add-from-drive-button').click();
      await tapContinue(page); // the first Google sign-in
      const medium = items(page).filter({ hasText: 'medium' });
      await downloadVideos(page, 'medium');
      await expect(medium).toHaveAttribute('data-downloaded', 'true');
    });
    await test.step('When I unlock search and type "medium"', async () => {
      await unlockSearch(page);
      await page.keyboard.type('medium');
    });
    await test.step('Then it is listed once, as downloaded', async () => {
      await expect(items(page)).toHaveCount(1);
      await expect(items(page)).toHaveAttribute('data-downloaded', 'true');
    });
  });

  test('Scenario: a failed or cancelled Face ID leaves search locked', async ({ page, setUp, seedLibrary, faceId }) => {
    await test.step('Given "tiny" and "medium" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
    });
    await test.step('When I tap search, Face ID fails, and I cancel', async () => {
      await faceId.willFail();
      await search(page).click();
      await expect(page.getByTestId('unlock-prompt')).toBeVisible();
      await page.getByTestId('unlock-cancel').click();
    });
    await test.step('Then search is still locked and the whole library is shown', async () => {
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      await expect(search(page)).toHaveAttribute('data-state', 'locked');
      await expect(search(page)).toHaveValue('');
      await expect(items(page)).toHaveCount(2);
    });
  });

  test('Scenario: leaving the field locks it again, and the results stay', async ({ page, setUp, seedLibrary, faceId }) => {
    await test.step('Given I searched for "tiny"', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
      await unlockSearch(page);
      await page.keyboard.type('tiny');
      await expect(items(page)).toHaveCount(1);
    });
    await test.step('When the search field loses focus', async () => {
      await search(page).blur();
    });
    await test.step('Then it is locked again, still showing "tiny" and its result', async () => {
      await expect(search(page)).toHaveAttribute('data-state', 'locked');
      await expect(search(page)).not.toBeEditable();
      await expect(search(page)).toHaveValue('tiny');
      await expect(items(page)).toHaveText([/tiny/]);
    });
    await test.step('And tapping it again asks for Face ID again', async () => {
      const before = await faceId.uses();
      await search(page).click();
      await expect.poll(() => faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: clearing the search needs no Face ID', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given I searched for "tiny" and search is locked again', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
      await unlockSearch(page);
      await page.keyboard.type('tiny');
      await search(page).blur();
      await expect(search(page)).toHaveAttribute('data-state', 'locked');
    });
    await test.step('When I tap the clear button', async () => {
      await page.getByTestId('search-clear').click();
    });
    await test.step('Then the whole library is shown, with no prompt', async () => {
      await expect(search(page)).toHaveValue('');
      await expect(items(page)).toHaveCount(2);
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
    });
  });

  test('Scenario: no matches says so', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    await test.step('When I unlock search and type "zebra"', async () => {
      await unlockSearch(page);
      await page.keyboard.type('zebra');
    });
    await test.step('Then no videos are shown and a note says nothing matches', async () => {
      await expect(items(page)).toHaveCount(0);
      await expect(page.getByTestId('search-empty')).toBeVisible();
    });
  });

  // Face ID takes a moment, so on a real iPad the keyboard comes up on the next
  // tap on the field (it stays unlocked until it loses focus).
  test('Scenario: on iPad, after Face ID the search field is focused and can be typed into @ipad', async ({ page, setUp }) => {
    await test.step('Given the library is open', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap search and pass Face ID', async () => {
      await search(page).click();
    });
    await test.step('Then the search field has focus, ready for typing', async () => {
      await expect(search(page)).toBeFocused();
      await expect(search(page)).toBeEditable();
    });
  });

  test('Scenario: tapping the unlocked search field again does not ask for Face ID again', async ({ page, setUp, seedLibrary, faceId }) => {
    await test.step('Given search is unlocked', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
      await unlockSearch(page);
    });
    const before = await faceId.uses();
    await test.step('When I tap the search field again', async () => {
      await search(page).click();
    });
    await test.step('Then Face ID is not asked and it stays unlocked', async () => {
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      expect(await faceId.uses()).toBe(before);
      await expect(search(page)).toHaveAttribute('data-state', 'unlocked');
    });
  });
});
