// Feature: Settings — behind the PIN; changing the PIN needs the current one.
import { test, expect, goto, enterPin, sha256Hex, PIN, WRONG_PIN } from '../../support.js';

test.describe('Feature: Settings', () => {
  test('Scenario: settings opens only with the PIN', async ({ page, pinSet }) => {
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

  test('Scenario: changing the PIN needs the current PIN', async ({ page, pinSet }) => {
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

  test('Scenario: a mismatched confirmation while changing the PIN asks again and keeps the old PIN', async ({ page, pinSet }) => {
    await test.step('Given I am changing the PIN, after giving the current one', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
      await page.getByTestId('change-pin-button').click();
      await enterPin(page, PIN);
    });
    await test.step('When I enter "5555" and confirm with "6666"', async () => {
      await enterPin(page, '5555');
      await enterPin(page, '6666');
    });
    await test.step('Then it says the PINs didn\'t match and asks for a new PIN again', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'change');
      await expect(page.getByTestId('pin-error')).toHaveText("The PINs didn't match. Try again.");
    });
    await test.step('And the old PIN is still the one stored', async () => {
      expect(await page.evaluate(() => localStorage.getItem('pin.sha256'))).toBe(sha256Hex(PIN));
    });
  });

  test('Scenario: going back while the settings PIN prompt is open returns to the library, still locked', async ({ page, pinSet }) => {
    await test.step('Given I tapped settings and its PIN prompt is open', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
    });
    await test.step('When I go back without entering the PIN', async () => {
      await page.goBack();
    });
    await test.step('Then the library is shown and the prompt is gone', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
    });
    await test.step('And settings asks for the PIN again next time', async () => {
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    });
  });
});
