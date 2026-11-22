// Feature: Playing needs Face ID — every time playback starts
// (unlocking: parental-controls/unlock.spec.js).
import {
  test, expect, goto, openVideo, expectPlaying, expectNotPlaying, playerState,
} from '../../support.js';

test.describe('Feature: Playing needs Face ID', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
    await goto(page, '#/library');
    await seedLibrary('medium');
    await openVideo(page, 'medium');
  });

  test('Scenario: play asks for Face ID, and passing it starts playback @ipad', async ({ page, faceId }) => {
    const before = await faceId.uses();
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').tap();
    });
    await test.step('Then the video plays, after Face ID', async () => {
      await expectPlaying(page);
      expect(await faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: a failed Face ID does not start playback @ipad', async ({ page, faceId }) => {
    await test.step('When I tap play and Face ID fails', async () => {
      await faceId.willFail();
      await page.getByTestId('play-button').tap();
    });
    await test.step('Then the unlock prompt shows, and nothing plays', async () => {
      await expect(page.getByTestId('unlock-prompt')).toHaveAttribute('data-mode', 'unlock');
      await expect(page.getByTestId('unlock-prompt')).toBeVisible();
      await expectNotPlaying(page);
    });
  });

  test('Scenario: cancelling the unlock prompt leaves the video paused @ipad', async ({ page, faceId }) => {
    await test.step('When I tap play, Face ID fails, and I cancel the prompt', async () => {
      await faceId.willFail();
      await page.getByTestId('play-button').tap();
      await page.getByTestId('unlock-cancel').tap();
    });
    await test.step('Then the prompt closes and the video is still paused', async () => {
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
    });
  });

  test('Scenario: after the end, play asks for Face ID and starts again from the beginning', async ({ page, faceId }) => {
    await test.step('Given "medium" has played to its end', async () => {
      await page.getByTestId('seek-bar').fill('58');
      await page.getByTestId('play-button').click();
      await expect(playerState(page)).toHaveAttribute('data-state', 'ended');
    });
    const before = await faceId.uses();
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').click();
    });
    await test.step('Then it plays again from the beginning', async () => {
      await expectPlaying(page);
      expect(await faceId.uses()).toBe(before + 1);
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBeLessThan(10);
    });
  });

  test('Scenario: going back while the unlock prompt is open closes it with the player', async ({ page, faceId }) => {
    await test.step('Given I tapped play, Face ID failed, and the unlock prompt is open', async () => {
      await faceId.willFail();
      await page.getByTestId('play-button').click();
      await expect(page.getByTestId('unlock-prompt')).toBeVisible();
    });
    await test.step('When I go back (the back gesture)', async () => {
      await page.goBack();
    });
    await test.step('Then the library is shown, with no prompt', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
    });
  });

  test('Scenario: if the device refuses to start playback, Play shows again', async ({ page }) => {
    await test.step('Given the device will refuse the next start of playback (as Safari can on iPad and iPhone)', async () => {
      await page.evaluate(() => {
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          HTMLMediaElement.prototype.play = play;
          return Promise.reject(new DOMException('The request is not allowed by the user agent.', 'NotAllowedError'));
        };
      });
    });
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').click();
    });
    await test.step('Then the video is paused, with the play button showing', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('play-button')).toBeVisible();
      await expectNotPlaying(page);
    });
    await test.step('When I tap play and pass Face ID again', async () => {
      await page.getByTestId('play-button').click();
    });
    await test.step('Then it plays', async () => {
      await expectPlaying(page);
    });
  });
});
