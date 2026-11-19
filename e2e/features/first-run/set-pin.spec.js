// Feature: First run — a parent sets a PIN before anything else is usable.
import { test, expect, goto, enterPin, sha256Hex } from '../../support.js';

test.describe('Feature: Set a PIN on first run', () => {
  test('Scenario: set and confirm a PIN, then land on the library', async ({ page }) => {
    await test.step('Given a fresh install with no PIN set', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the PIN prompt asks to set a PIN', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
    });
    await test.step('When I enter "2468" and confirm it', async () => {
      await enterPin(page, '2468');
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'confirm');
      await enterPin(page, '2468');
    });
    await test.step('Then the prompt closes and the library is shown', async () => {
      await expect(page.getByTestId('pin-prompt')).toBeHidden();
      await expect(page.getByTestId('screen-library')).toBeVisible();
    });
    await test.step('And only the hash of the PIN is stored', async () => {
      expect(await page.evaluate(() => localStorage.getItem('pin.sha256'))).toBe(sha256Hex('2468'));
    });
  });

  test('Scenario: a mismatched confirmation starts setup again', async ({ page }) => {
    await test.step('Given a fresh install with no PIN set', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I enter "2468" and then confirm with "1357"', async () => {
      await enterPin(page, '2468');
      await enterPin(page, '1357');
    });
    await test.step('Then an error is shown, setup starts again, and no PIN is stored', async () => {
      await expect(page.getByTestId('pin-error')).toBeVisible();
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
      expect(await page.evaluate(() => localStorage.getItem('pin.sha256'))).toBeNull();
    });
  });

  test('Scenario: the setup prompt cannot be dismissed', async ({ page }) => {
    await test.step('Given a fresh install with no PIN set', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the setup prompt has no cancel button', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
      await expect(page.getByTestId('pin-cancel')).toBeHidden();
    });
  });

  test('Scenario: the PIN itself is never stored or left behind', async ({ page, context }) => {
    const pin = '24680';
    await test.step('Given I set the PIN on first run and then use it to unlock settings', async () => {
      await goto(page, '#/library');
      await enterPin(page, pin);
      await enterPin(page, pin);
      await page.getByTestId('settings-button').click();
      await enterPin(page, pin);
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('Then only its SHA-256 hash is stored', async () => {
      expect(await page.evaluate(() => localStorage.getItem('pin.sha256'))).toBe(sha256Hex(pin));
    });
    await test.step('And the PIN appears nowhere: storage, cookies, URL, or the input field', async () => {
      const found = await page.evaluate((p) => {
        const hits = [];
        for (const [name, store] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) {
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k.includes(p) || (store.getItem(k) ?? '').includes(p)) hits.push(`${name}:${k}`);
          }
        }
        if (document.cookie.includes(p)) hits.push('cookie');
        if (location.href.includes(p)) hits.push('url');
        if (document.querySelector('[data-testid="pin-input"]').value !== '') hits.push('pin-input not cleared');
        return hits;
      }, pin);
      expect(found).toEqual([]);
      expect((await context.cookies()).filter((c) => c.value.includes(pin))).toEqual([]);
    });
  });

  test.fixme('Scenario: a new PIN that is too short or not only digits is refused', async ({ page }) => {
    await test.step('Given a fresh install with no PIN set', async () => {
      await goto(page, '#/library');
    });
    for (const pin of ['123', '12ab']) {
      await test.step(`When I enter "${pin}"`, async () => {
        await enterPin(page, pin);
      });
      await test.step('Then it is refused with "Use 4 to 6 digits." and setup continues', async () => {
        await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
        await expect(page.getByTestId('pin-error')).toHaveText('Use 4 to 6 digits.');
        await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
      });
    }
    await test.step('When I enter "2468"', async () => {
      await enterPin(page, '2468');
    });
    await test.step('Then I am asked to confirm it', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'confirm');
    });
  });
});
