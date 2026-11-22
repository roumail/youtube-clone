// Feature: Works on iPhone — portrait and landscape.
// Runs only in the iphone-portrait and iphone-landscape projects (@iphone).
// Face ID is simulated there (it always passes): e2e/support.js.
import { test, expect, goto } from '../../support.js';

test.describe('Feature: Works on iPhone', () => {
  test('Scenario: first run fits the screen width, and the page is not zoomed @iphone', async ({ page }) => {
    await test.step('Given a fresh install', async () => {
      await goto(page, '#/library');
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'setup');
    });
    await test.step('Then the setup card and its button are on screen, and the page is not zoomed', async () => {
      const fit = await page.evaluate(() => {
        const r = document.querySelector('.unlock-card').getBoundingClientRect();
        return { inside: r.left >= 0 && r.right <= window.innerWidth, scale: window.visualViewport.scale };
      });
      expect(fit).toEqual({ inside: true, scale: 1 });
      await expect(page.getByTestId('setup-faceid-button')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /maximum-scale=1/);
    });
    await test.step('And setting up Face ID lands on the library', async () => {
      await page.getByTestId('setup-faceid-button').tap();
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      await expect(page.getByTestId('screen-library')).toBeVisible();
    });
  });

  test('Scenario: the library and settings fit the screen width @iphone', async ({ page, setUp }) => {
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
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('Then it does not scroll sideways either', async () => {
      expect(await sideways()).toBe(false);
    });
  });
});
