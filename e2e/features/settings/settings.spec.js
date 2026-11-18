// Feature: Settings — behind the PIN; changing the PIN needs the current one.
import { test, expect, goto, enterPin, sha256Hex, PIN, WRONG_PIN } from '../../support.js';

test.describe('Feature: Settings', () => {
  test.fixme('Scenario: settings opens only with the PIN', async ({ page, pinSet }) => {
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

  test.fixme('Scenario: changing the PIN needs the current PIN', async ({ page, pinSet }) => {
    await test.step('Given settings is unlocked', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
    });
    await test.step('When I tap "Change PIN" and give a wrong current PIN', async () => {
      await page.getByTestId('change-pin-button').click();
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
});
