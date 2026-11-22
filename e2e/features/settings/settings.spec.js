// Feature: Settings — behind unlocking (Face ID / Touch ID: unlock.spec.js).
import { test, expect, goto } from '../../support.js';

const unlockPrompt = (page) => page.getByTestId('unlock-prompt');

test.describe('Feature: Settings', () => {
  test('Scenario: settings opens only after Face ID', async ({ page, setUp, faceId }) => {
    await test.step('Given the library is shown, and Face ID will fail', async () => {
      await goto(page, '#/library');
      await faceId.willFail();
    });
    await test.step('When I tap settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then settings is locked behind the unlock prompt', async () => {
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'unlock');
    });
    await test.step('When I tap "Use Face ID" and pass it', async () => {
      await faceId.willPass();
      await page.getByTestId('unlock-faceid-button').click();
    });
    await test.step('Then settings unlocks', async () => {
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });

  test('Scenario: going back while the unlock prompt is open returns to the library, still locked', async ({ page, setUp, faceId }) => {
    await test.step('Given Face ID failed after tapping settings, and the unlock prompt is open', async () => {
      await goto(page, '#/library');
      await faceId.willFail();
      await page.getByTestId('settings-button').click();
      await expect(unlockPrompt(page)).toBeVisible();
    });
    await test.step('When I go back', async () => {
      await page.goBack();
    });
    await test.step('Then the library is shown and the prompt is gone', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(unlockPrompt(page)).toBeHidden();
    });
    await test.step('And settings asks to unlock again next time', async () => {
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'unlock');
    });
  });

  test('Scenario: cancelling the unlock prompt returns to the library', async ({ page, setUp, faceId }) => {
    await test.step('Given Face ID failed after tapping settings, and the unlock prompt is open', async () => {
      await goto(page, '#/library');
      await faceId.willFail();
      await page.getByTestId('settings-button').click();
      await expect(unlockPrompt(page)).toBeVisible();
    });
    await test.step('When I tap Cancel', async () => {
      await page.getByTestId('unlock-cancel').click();
    });
    await test.step('Then the library is shown and settings stays locked', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(unlockPrompt(page)).toBeHidden();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
    });
  });
});
