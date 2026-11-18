// Rule: settings (change PIN, remove video) are behind the PIN.
import { test, expect, goto, enterPin, sha256Hex, PIN, WRONG_PIN } from './support.js';

async function openSettings(page) {
  await page.getByTestId('settings-button').click();
  await enterPin(page, PIN);
  await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
}

test.fixme('settings opens only with the PIN', async ({ page, pinSet }) => {
  await test.step('Given the library is shown', async () => {
    await goto(page, '#/library');
  });
  await test.step('When I tap settings', async () => {
    await page.getByTestId('settings-button').click();
  });
  await test.step('Then settings is locked behind the PIN prompt', async () => {
    await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
  });
  await test.step('When I enter the correct PIN', async () => {
    await enterPin(page, PIN);
  });
  await test.step('Then settings unlocks', async () => {
    await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
  });
});

test.fixme('changing the PIN needs the current PIN', async ({ page, pinSet }) => {
  await test.step('Given settings is unlocked', async () => {
    await goto(page, '#/library');
    await openSettings(page);
  });
  await test.step('When I tap "Change PIN" and give a wrong current PIN', async () => {
    await page.getByTestId('change-pin-button').click();
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    await enterPin(page, WRONG_PIN);
  });
  await test.step('Then the change is refused', async () => {
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
  });
  await test.step('When I give the current PIN, then "5555" twice', async () => {
    await enterPin(page, PIN);
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'change');
    await enterPin(page, '5555');
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'confirm');
    await enterPin(page, '5555');
  });
  await test.step('Then the new PIN is stored', async () => {
    await expect(page.getByTestId('pin-prompt')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('pin.sha256'))).toBe(sha256Hex('5555'));
  });
});

test.fixme('removing a video', async ({ page, pinSet, seedLibrary }) => {
  await test.step('Given "tiny" and "medium" are stored and settings is unlocked', async () => {
    await goto(page, '#/library');
    await seedLibrary('tiny', 'medium');
    await openSettings(page);
  });
  await test.step('When I remove "tiny"', async () => {
    await page.getByTestId('settings-video-item').filter({ hasText: 'tiny' })
      .getByTestId('remove-video-button').click();
  });
  await test.step('Then only "medium" is left in the library', async () => {
    await expect(page.getByTestId('settings-video-item')).toHaveCount(1);
    await page.getByTestId('screen-settings').getByTestId('back-button').click();
    await expect(page.getByTestId('library-item')).toHaveCount(1);
    await expect(page.getByTestId('library-item').filter({ hasText: 'medium' })).toBeVisible();
  });
});
