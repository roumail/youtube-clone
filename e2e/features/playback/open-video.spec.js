// Feature: Open a video — it opens in the same app, paused, never by itself.
import { test, expect, goto, openVideo, expectNotPlaying, playerState } from '../../support.js';

test.describe('Feature: Open a video', () => {
  test('Scenario: tapping a video opens the player in the same app, not a new tab', async ({ page, context, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    await test.step('When I tap "tiny"', async () => {
      await page.getByTestId('library-item').filter({ hasText: 'tiny' }).click();
    });
    await test.step('Then the player shows in the same page, and no other tab or window opened', async () => {
      await expect(page.getByTestId('screen-player')).toBeVisible();
      await expect(page).toHaveURL(/#\/player\//);
      expect(context.pages()).toHaveLength(1);
    });
  });

  test('Scenario: an opened video is paused at the start', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is stored', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
    });
    await test.step('When I open "tiny"', async () => {
      await openVideo(page, 'tiny');
    });
    await test.step('Then it is paused at 0:00', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expectNotPlaying(page);
      expect(await page.getByTestId('player-video').evaluate((v) => v.currentTime)).toBe(0);
    });
  });

  test('Scenario: the video element cannot bypass the app controls', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await openVideo(page, 'tiny');
    });
    await test.step('Then there is no autoplay, no native controls, no picture-in-picture and no AirPlay', async () => {
      const attrs = await page.getByTestId('player-video').evaluate((v) => ({
        autoplay: v.autoplay, controls: v.controls, playsInline: v.playsInline,
        disablePictureInPicture: v.disablePictureInPicture, disableRemotePlayback: v.disableRemotePlayback,
      }));
      expect(attrs).toEqual({
        autoplay: false, controls: false, playsInline: true, disablePictureInPicture: true, disableRemotePlayback: true,
      });
    });
  });

  test('Scenario: the player fills the whole screen, in landscape and portrait', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is open', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await openVideo(page, 'tiny');
    });
    for (const [orientation, size] of [['landscape', { width: 1180, height: 820 }], ['portrait', { width: 820, height: 1180 }]]) {
      await test.step(`Then in ${orientation} the video area covers the full screen, with the controls on it`, async () => {
        await page.setViewportSize(size);
        const box = await page.getByTestId('player-video').boundingBox();
        expect(box).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
        for (const id of ['play-button', 'back-button']) {
          const button = page.getByTestId('screen-player').getByTestId(id);
          await expect(button).toBeInViewport();
        }
      });
    }
  });

  test.fixme('Scenario: a video whose stored parts are gone shows an error instead of playing', async ({ page, pinSet, seedLibrary }) => {
    await test.step('Given "tiny" is listed, but the browser has since deleted its stored video and audio', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('shaka_offline_db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const stores = [...db.objectStoreNames].filter((name) => name.startsWith('segment'));
          const tx = db.transaction(stores, 'readwrite');
          for (const name of stores) tx.objectStore(name).clear();
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }));
    });
    await test.step('When I open "tiny"', async () => {
      await page.getByTestId('library-item').filter({ hasText: 'tiny' }).click();
    });
    await test.step('Then the player shows an error, with no play button', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'error');
      await expect(page.getByTestId('play-button')).toBeHidden();
    });
  });
});
