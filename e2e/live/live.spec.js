// Post-deploy release gate (runs only from deploy.yml, against the PUBLIC site):
// the live app is this exact commit, boots cleanly, and the spike isn't public.
// CSP violations and page errors fail it too (support.js fixture).
import { test, expect, goto } from '../support.js';

test.describe('Live site after deploy', () => {
  test('Scenario: the deployed commit is live', async ({ request }) => {
    const res = await request.get('./version.json', { headers: { 'Cache-Control': 'no-cache' } });
    expect(res.ok()).toBe(true);
    expect((await res.json()).commit).toBe(process.env.EXPECTED_SHA);
  });

  test('Scenario: a fresh install boots to the PIN setup prompt', async ({ page }) => {
    await test.step('Given a fresh browser opens the public app', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then it asks to set a PIN', async () => {
      await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'setup');
    });
  });

  test('Scenario: the app boots with a PIN and shows the library', async ({ page, pinSet }) => {
    await goto(page, '#/library');
    await expect(page.getByTestId('screen-library')).toBeVisible();
  });

  test('Scenario: the M0 spike is not published', async ({ request }) => {
    expect((await request.get('./spike/')).status()).toBe(404);
  });
});
