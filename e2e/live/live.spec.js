// Post-deploy release gate (runs only from deploy.yml, against the PUBLIC site):
// the live app is this exact release and commit, and boots cleanly.
// CSP violations and page errors fail it too (support.js fixture).
import { test, expect, goto } from '../support.js';

test.describe('Live site after deploy', () => {
  test('Scenario: the released version and commit are live', async ({ request }) => {
    const res = await request.get('./version.json', { headers: { 'Cache-Control': 'no-cache' } });
    expect(res.ok()).toBe(true);
    const live = await res.json();
    expect(live.commit).toBe(process.env.EXPECTED_SHA);
    expect(live.version).toBe(process.env.EXPECTED_VERSION);
  });

  test('Scenario: a fresh install boots to the Face ID setup prompt', async ({ page }) => {
    await test.step('Given a fresh browser opens the public app', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then it asks to set up Face ID', async () => {
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'setup');
    });
  });

  test('Scenario: the app boots with Face ID set up and shows the library', async ({ page, setUp }) => {
    await goto(page, '#/library');
    await expect(page.getByTestId('screen-library')).toBeVisible();
  });

  test('Scenario: the library shows the released version', async ({ page, setUp }) => {
    await goto(page, '#/library');
    await expect(page.getByTestId('app-version')).toHaveText(process.env.EXPECTED_VERSION);
  });
});
