// Feature: Works on iPhone — portrait and landscape.
// Runs only in the iphone-portrait and iphone-landscape projects (@iphone).
// The on-screen keyboard can't be shown in CI, so `onScreenKeyboard` models it
// the way iPhone Safari reports it: typing into a field shrinks
// window.visualViewport by the keyboard's height; the page itself doesn't move.
import { test, expect, goto, enterPin, onScreenKeyboard, PIN, WRONG_PIN } from '../../support.js';

// Ids (inside the PIN prompt) that are not fully inside the visible area above
// the keyboard; plus whether the keyboard is up and whether the page scrolled.
async function pinPromptLayout(page, ids) {
  return page.evaluate((ids) => {
    const vv = window.visualViewport;
    const top = vv.offsetTop;
    const bottom = vv.offsetTop + vv.height;
    const hidden = ids.filter((id) => {
      const r = document.querySelector(`[data-testid="pin-prompt"] [data-testid="${id}"]`).getBoundingClientRect();
      return !(r.top >= top && r.bottom <= bottom && r.left >= 0 && r.right <= window.innerWidth);
    });
    return { hidden, keyboardUp: vv.height < window.innerHeight, scrolled: window.scrollX !== 0 || window.scrollY !== 0 };
  }, ids);
}

async function expectAboveKeyboard(page, ids) {
  await expect.poll(() => pinPromptLayout(page, ids)).toEqual({ hidden: [], keyboardUp: true, scrolled: false });
}

test.describe('Feature: Works on iPhone', () => {
  test('Scenario: the PIN prompt stays above the keyboard @iphone', async ({ page, pinSet }) => {
    await onScreenKeyboard(page);
    await test.step('Given the library is open', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap Settings and the keyboard comes up for the PIN', async () => {
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('pin-prompt')).toBeVisible();
      await page.getByTestId('pin-input').focus();
    });
    await test.step('Then the PIN field, Cancel and OK are fully above the keyboard, without scrolling', async () => {
      await expectAboveKeyboard(page, ['pin-input', 'pin-cancel', 'pin-submit']);
    });
    await test.step('And entering the PIN opens Settings', async () => {
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });

  test('Scenario: a wrong PIN message stays above the keyboard @iphone', async ({ page, pinSet }) => {
    await onScreenKeyboard(page);
    await test.step('Given the PIN prompt is open from Settings', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
    });
    await test.step('When I enter a wrong PIN and the keyboard is up', async () => {
      await enterPin(page, WRONG_PIN);
      await expect(page.getByTestId('pin-error')).toBeVisible();
      await page.getByTestId('pin-input').focus();
    });
    await test.step('Then the message, the PIN field and OK are fully above the keyboard, without scrolling', async () => {
      await expectAboveKeyboard(page, ['pin-error', 'pin-input', 'pin-submit']);
    });
  });

  test('Scenario: setting the PIN on first run stays above the keyboard @iphone', async ({ page }) => {
    await onScreenKeyboard(page);
    await test.step('Given a fresh install with no PIN set', async () => {
      await goto(page, '#/library');
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
    });
    await test.step('Then with the keyboard up, the PIN field and OK are fully above it, without scrolling', async () => {
      await page.getByTestId('pin-input').focus();
      await expectAboveKeyboard(page, ['pin-input', 'pin-submit']);
    });
    await test.step('And the PIN card fits the screen width, and the page is not zoomed', async () => {
      const fit = await page.evaluate(() => {
        const r = document.querySelector('.pin-card').getBoundingClientRect();
        return { inside: r.left >= 0 && r.right <= window.innerWidth, scale: window.visualViewport.scale };
      });
      expect(fit).toEqual({ inside: true, scale: 1 });
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /maximum-scale=1/);
    });
    await test.step('When I enter a PIN, the confirm step is fully above the keyboard too', async () => {
      await enterPin(page, '2468');
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'confirm');
      await page.getByTestId('pin-input').focus();
      await expectAboveKeyboard(page, ['pin-input', 'pin-submit']);
    });
    await test.step('And confirming it lands on the library', async () => {
      await enterPin(page, '2468');
      await expect(page.getByTestId('screen-library')).toBeVisible();
    });
  });

  test('Scenario: the library and settings fit the screen width @iphone', async ({ page, pinSet }) => {
    const sideways = () => page.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth);
    await test.step('Given the library is open', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then it does not scroll sideways, and its buttons are on screen', async () => {
      expect(await sideways()).toBe(false);
      for (const id of ['add-video-button', 'settings-button']) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
    });
    await test.step('When I unlock Settings', async () => {
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('Then it does not scroll sideways either', async () => {
      expect(await sideways()).toBe(false);
    });
  });
});
