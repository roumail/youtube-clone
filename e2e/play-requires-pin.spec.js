// Rule: pausing is free; playing (and every resume) needs the PIN.
import {
  test, expect, goto, enterPin, openVideo, expectPlaying, expectNotPlaying, playerState, PIN, WRONG_PIN,
} from './support.js';

test.beforeEach(async ({ page, pinSet, seedLibrary }) => {
  await goto(page, '#/library');
  await seedLibrary('medium');
  await openVideo(page, 'medium');
});

test.fixme('play asks for the PIN, and the correct PIN starts playback', async ({ page }) => {
  await test.step('Given "medium" is open and paused', async () => {
    await expectNotPlaying(page);
  });
  await test.step('When I tap play', async () => {
    await page.getByTestId('play-button').click();
  });
  await test.step('Then the PIN prompt is shown and the video is still not playing', async () => {
    await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-mode', 'verify');
    await expectNotPlaying(page);
  });
  await test.step('When I enter the correct PIN', async () => {
    await enterPin(page, PIN);
  });
  await test.step('Then the video plays', async () => {
    await expectPlaying(page);
  });
});

test.fixme('a wrong PIN does not start playback', async ({ page }) => {
  await test.step('Given I tapped play on "medium"', async () => {
    await page.getByTestId('play-button').click();
  });
  await test.step('When I enter a wrong PIN', async () => {
    await enterPin(page, WRONG_PIN);
  });
  await test.step('Then the prompt says it is wrong and the video is not playing', async () => {
    await expect(page.getByTestId('pin-prompt')).toHaveAttribute('data-state', 'wrong');
    await expectNotPlaying(page);
  });
});

test.fixme('cancelling the PIN prompt leaves the video paused', async ({ page }) => {
  await test.step('Given I tapped play on "medium"', async () => {
    await page.getByTestId('play-button').click();
  });
  await test.step('When I cancel the PIN prompt', async () => {
    await page.getByTestId('pin-cancel').click();
  });
  await test.step('Then the prompt closes and the video is paused', async () => {
    await expect(page.getByTestId('pin-prompt')).toBeHidden();
    await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    await expectNotPlaying(page);
  });
});

test.fixme('pausing is free, and resuming asks for the PIN again', async ({ page }) => {
  await test.step('Given "medium" is playing', async () => {
    await page.getByTestId('play-button').click();
    await enterPin(page, PIN);
    await expectPlaying(page);
  });
  await test.step('When I tap pause', async () => {
    await page.getByTestId('pause-button').click();
  });
  await test.step('Then it pauses without asking for the PIN', async () => {
    await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    await expect(page.getByTestId('pin-prompt')).toBeHidden();
    await expectNotPlaying(page);
  });
  await test.step('When I tap play again', async () => {
    await page.getByTestId('play-button').click();
  });
  await test.step('Then the PIN is required again', async () => {
    await expect(playerState(page)).toHaveAttribute('data-state', 'pin-required');
    await expectNotPlaying(page);
  });
});
