// Feature: PIN lockout — 5 wrong PINs lock the prompt for 60 s; a reload
// doesn't reset it. Uses Playwright's fake clock, so no real waiting.
import { test, expect, goto, enterPin, PIN, WRONG_PIN } from '../../support.js';

test.describe('Feature: PIN lockout', () => {
  test('Scenario: 5 wrong PINs lock out for 60 seconds, even across a reload', async ({ page, pinSet }) => {
    await page.clock.install();
    const prompt = page.getByTestId('pin-prompt');
    await test.step('Given the settings PIN prompt is open', async () => {
      await goto(page, '#/settings');
      await expect(prompt).toHaveAttribute('data-mode', 'verify');
    });
    await test.step('When I enter a wrong PIN 5 times', async () => {
      for (let i = 0; i < 5; i++) await enterPin(page, WRONG_PIN);
    });
    await test.step('Then the prompt is locked out', async () => {
      await expect(prompt).toHaveAttribute('data-state', 'locked-out');
      await expect(prompt.getByTestId('pin-submit')).toBeDisabled();
    });
    await test.step('When I reload the app', async () => {
      await page.reload();
    });
    await test.step('Then it is still locked out', async () => {
      await expect(prompt).toHaveAttribute('data-state', 'locked-out');
    });
    await test.step('When 60 seconds pass', async () => {
      await page.clock.fastForward('01:01');
    });
    await test.step('Then the correct PIN unlocks settings', async () => {
      await expect(prompt).toHaveAttribute('data-state', 'entry');
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });

  test('Scenario: 4 wrong PINs then the right one does not lock out', async ({ page, pinSet }) => {
    await test.step('Given the settings PIN prompt is open', async () => {
      await goto(page, '#/settings');
    });
    await test.step('When I enter a wrong PIN 4 times and then the correct PIN', async () => {
      for (let i = 0; i < 4; i++) await enterPin(page, WRONG_PIN);
      await enterPin(page, PIN);
    });
    await test.step('Then settings unlocks', async () => {
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });
});
