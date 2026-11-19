// Feature: Search the library — a parent narrows the library by title.
// Typing needs the PIN; clearing is free.
import { test, expect, goto, enterPin, PIN, WRONG_PIN } from '../../support.js';

const search = (page) => page.getByTestId('search-input');
const items = (page) => page.getByTestId('library-item');

async function unlockSearch(page) {
  await search(page).click();
  await enterPin(page, PIN);
  await expect(search(page)).toHaveAttribute('data-state', 'unlocked');
}

test.describe('Feature: Search the library', () => {
  test('Scenario: typing into search needs the PIN', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" and "medium" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
    });
    await test.step('Then the search field is locked and cannot be typed into', async () => {
      await expect(search(page)).toHaveAttribute('data-state', 'locked');
      await expect(search(page)).not.toBeEditable();
    });
    await test.step('When I tap the search field', async () => {
      await search(page).click();
    });
    await test.step('Then the PIN prompt asks for the PIN', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    });
  });

  test('Scenario: after the PIN, typing narrows the library by title', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny", "medium" and "episode-like" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium', 'episode-like');
    });
    await test.step('When I tap search, enter the PIN and type "TIN"', async () => {
      await unlockSearch(page);
      await expect(search(page)).toBeFocused();
      await page.keyboard.type('TIN');
    });
    await test.step('Then only videos whose title contains it (any case) are shown', async () => {
      await expect(items(page)).toHaveText([/tiny/]);
    });
  });

  test('Scenario: a series is found by its name, episodes in order', async ({ page, pinSet, seedLibrary }) => {
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

  test('Scenario: a wrong or cancelled PIN leaves search locked', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" and "medium" are stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
    });
    await test.step('When I tap search and enter a wrong PIN, then cancel', async () => {
      await search(page).click();
      await enterPin(page, WRONG_PIN);
      await expect(page.getByTestId('pin-error')).toBeVisible();
      await page.getByTestId('pin-cancel').click();
    });
    await test.step('Then search is still locked and the whole library is shown', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expect(search(page)).toHaveAttribute('data-state', 'locked');
      await expect(search(page)).toHaveValue('');
      await expect(items(page)).toHaveCount(2);
    });
  });

  test('Scenario: leaving the field locks it again, and the results stay', async ({ page, pinSet, seedLibrary }) => {
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
    await test.step('And tapping it again asks for the PIN again', async () => {
      await search(page).click();
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
    });
  });

  test('Scenario: clearing the search needs no PIN', async ({ page, pinSet, seedLibrary }) => {
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
    await test.step('Then the whole library is shown, with no PIN prompt', async () => {
      await expect(search(page)).toHaveValue('');
      await expect(items(page)).toHaveCount(2);
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
    });
  });

  test('Scenario: no matches says so', async ({ page, pinSet, seedLibrary }) => {
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

  test('Scenario: on iPad the keyboard comes up right after the PIN @ipad', async ({ page, pinSet }) => {
    await test.step('Given the library is open', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap search and enter the PIN', async () => {
      await search(page).click();
      await enterPin(page, PIN);
    });
    await test.step('Then the search field has focus within the same tap, ready for typing', async () => {
      await expect(search(page)).toBeFocused();
      await expect(search(page)).toBeEditable();
    });
  });
});
