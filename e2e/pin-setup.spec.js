// Rule: on first launch a parent sets a PIN before anything else is usable.
import { test, expect, goto, enterPin, sha256Hex } from './support.js';

test.fixme('first launch: set and confirm a PIN, then land on the library', async ({ page }) => {
  await test.step('Given a fresh install with no PIN set', async () => {
    await goto(page, '#/library');
  });
  await test.step('Then the PIN prompt asks to set a PIN', async () => {
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
  });
  await test.step('When I enter "2468"', async () => {
    await enterPin(page, '2468');
  });
  await test.step('Then it asks me to confirm it', async () => {
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'confirm');
  });
  await test.step('When I enter "2468" again', async () => {
    await enterPin(page, '2468');
  });
  await test.step('Then the prompt closes and the library is shown', async () => {
    await expect(page.getByTestId('pin-prompt')).toBeHidden();
    await expect(page.getByTestId('screen-library')).toBeVisible();
  });
  await test.step('And only the hash of the PIN is stored', async () => {
    const stored = await page.evaluate(() => localStorage.getItem('pin.sha256'));
    expect(stored).toBe(sha256Hex('2468'));
  });
});

test.fixme('first launch: a mismatched confirmation starts setup again', async ({ page }) => {
  await test.step('Given a fresh install with no PIN set', async () => {
    await goto(page, '#/library');
  });
  await test.step('When I enter "2468" and then confirm with "1357"', async () => {
    await enterPin(page, '2468');
    await enterPin(page, '1357');
  });
  await test.step('Then an error is shown and the prompt is back in setup mode', async () => {
    await expect(page.getByTestId('pin-error')).toBeVisible();
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
  });
  await test.step('And no PIN is stored', async () => {
    expect(await page.evaluate(() => localStorage.getItem('pin.sha256'))).toBeNull();
  });
});

test.fixme('first launch: the setup prompt cannot be dismissed', async ({ page }) => {
  await test.step('Given a fresh install with no PIN set', async () => {
    await goto(page, '#/library');
  });
  await test.step('Then there is no cancel button on the setup prompt', async () => {
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
    await expect(page.getByTestId('pin-cancel')).toBeHidden();
  });
});
