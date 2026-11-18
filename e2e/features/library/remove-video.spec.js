// Feature: Remove a video — from settings, behind the PIN.
import { test, expect, goto, enterPin, PIN } from '../../support.js';

test.describe('Feature: Remove a video', () => {
  test('Scenario: removing one of two videos leaves the other', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" and "medium" are stored and settings is unlocked', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny', 'medium');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('When I remove "tiny"', async () => {
      await page.getByTestId('settings-video-item').filter({ hasText: 'tiny' })
        .getByTestId('remove-video-button').click();
    });
    await test.step('Then only "medium" is left', async () => {
      await expect(page.getByTestId('settings-video-item')).toHaveCount(1);
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await expect(page.getByTestId('library-item')).toHaveCount(1);
      await expect(page.getByTestId('library-item').filter({ hasText: 'medium' })).toBeVisible();
    });
  });
});
