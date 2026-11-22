// Feature: Play several (a playlist) — a parent ticks several videos and they
// play one after another, with Face ID asked once, at the start.
//
// Two ways to play: tap a video to play it alone (it stops at its end, as
// always), or hold a video to start selecting, tick more, and play them all.
// Holding a tile (library or series) ticks it and starts selecting; a tap then
// ticks or unticks. Ticking needs no Face ID: nothing plays until Face ID passes.
// Videos play in the order they were ticked. There are no next / previous
// buttons: the playlist only moves on when a video ends.
//
// A playlist is an ordered list of catalogue ids (the ids in #/player/<id>).
// It is not saved yet: it lives until the playlist ends, back is tapped, or the
// app reloads. Saved playlists, if added later, are kept in this device's
// browser storage, as that same list of ids.
import {
  test, expect, goto, startPlaying, expectPlaying, expectNotPlaying, playerState,
  mediaSessionAction,
} from '../../support.js';

const tile = (page, title) => page.getByTestId('library-item').filter({ hasText: title });

// A held tap: the finger stays down for 600 ms (the app's hold is 500 ms).
// Lifting it may still send a click (Chrome does), which must not count as a tap.
async function hold(page, locator) {
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
  await page.clock.runFor(600);
  await locator.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, button: 0 });
  await locator.dispatchEvent('click');
}

// Hold the first title, tap the rest: the playlist in that order.
async function select(page, first, ...rest) {
  await hold(page, tile(page, first));
  for (const title of rest) await tile(page, title).tap();
}

// The player's URL names the video by its catalogue id, which its library tile carries.
async function isOpen(page, title) {
  const id = await tile(page, title).getAttribute('data-video-id');
  return decodeURIComponent(page.url()).endsWith(`#/player/${id}`);
}

test.describe('Feature: Play several (a playlist)', () => {
  test.beforeEach(async ({ page, setUp, seedLibrary }) => {
    await page.clock.install();
    await goto(page, '#/library');
    await seedLibrary('tiny', 'Second', 'medium', 'Show - S01E01 - First', 'Show - S01E02 - Second');
  });

  test('Scenario: holding a video starts selecting and ticks it, without opening it or asking for Face ID @ipad', async ({ page }) => {
    await test.step('When I hold "tiny"', async () => {
      await hold(page, tile(page, 'tiny'));
    });
    await test.step('Then the library is selecting, "tiny" is ticked as 1, and no prompt or player is shown', async () => {
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-mode', 'select');
      await expect(tile(page, 'tiny')).toHaveAttribute('aria-checked', 'true');
      await expect(tile(page, 'tiny').getByTestId('selection-number')).toHaveText('1');
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      await expect(page.getByTestId('screen-player')).toBeHidden();
    });
  });

  test('Scenario: while selecting, a tap ticks a video and each shows its place', async ({ page }) => {
    await test.step('When I hold "medium", then tap "tiny"', async () => {
      await select(page, 'medium', 'tiny');
    });
    await test.step('Then "medium" is 1, "tiny" is 2, and the bar says "2 selected"', async () => {
      await expect(tile(page, 'medium').getByTestId('selection-number')).toHaveText('1');
      await expect(tile(page, 'tiny').getByTestId('selection-number')).toHaveText('2');
      await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
    });
  });

  test('Scenario: a tap on a ticked video unticks it and the others move up', async ({ page }) => {
    await test.step('Given "tiny", "Second" and "medium" are ticked in that order', async () => {
      await select(page, 'tiny', 'Second', 'medium');
    });
    await test.step('When I tap "tiny"', async () => {
      await tile(page, 'tiny').tap();
    });
    await test.step('Then "tiny" is not ticked, "Second" is 1 and "medium" is 2', async () => {
      await expect(tile(page, 'tiny')).toHaveAttribute('aria-checked', 'false');
      await expect(tile(page, 'Second').getByTestId('selection-number')).toHaveText('1');
      await expect(tile(page, 'medium').getByTestId('selection-number')).toHaveText('2');
    });
  });

  test('Scenario: unticking the last ticked video stops selecting', async ({ page }) => {
    await test.step('Given only "tiny" is ticked', async () => {
      await select(page, 'tiny');
    });
    await test.step('When I tap "tiny"', async () => {
      await tile(page, 'tiny').tap();
    });
    await test.step('Then the library is no longer selecting, and a tap on "tiny" opens it', async () => {
      await expect(page.getByTestId('screen-library')).not.toHaveAttribute('data-mode', 'select');
      await tile(page, 'tiny').tap();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    });
  });

  test('Scenario: episodes in a series can be ticked along with other videos', async ({ page }) => {
    await test.step('Given "tiny" is ticked', async () => {
      await select(page, 'tiny');
    });
    await test.step('When I open the "Show" series and tap E02, then E01', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await page.getByTestId('episode-item').filter({ hasText: 'S01E02' }).tap();
      await page.getByTestId('episode-item').filter({ hasText: 'S01E01' }).tap();
    });
    await test.step('Then E02 is 2 and E01 is 3, and the bar says "3 selected"', async () => {
      await expect(page.getByTestId('episode-item').filter({ hasText: 'S01E02' }).getByTestId('selection-number')).toHaveText('2');
      await expect(page.getByTestId('episode-item').filter({ hasText: 'S01E01' }).getByTestId('selection-number')).toHaveText('3');
      await expect(page.getByTestId('selection-count')).toHaveText('3 selected');
    });
    await test.step('When I go back to the library', async () => {
      await page.getByTestId('screen-series').getByTestId('back-button').tap();
    });
    await test.step('Then "tiny" is still 1 and the bar still says "3 selected"', async () => {
      await expect(tile(page, 'tiny').getByTestId('selection-number')).toHaveText('1');
      await expect(page.getByTestId('selection-count')).toHaveText('3 selected');
    });
  });

  test('Scenario: holding an episode in a series starts selecting too', async ({ page }) => {
    await test.step('When I open the "Show" series and hold E01', async () => {
      await page.getByTestId('series-item').filter({ hasText: 'Show' }).tap();
      await hold(page, page.getByTestId('episode-item').filter({ hasText: 'S01E01' }));
    });
    await test.step('Then E01 is ticked as 1 and nothing opens', async () => {
      await expect(page.getByTestId('episode-item').filter({ hasText: 'S01E01' }).getByTestId('selection-number')).toHaveText('1');
      await expect(page.getByTestId('screen-series')).toBeVisible();
    });
  });

  test('Scenario: Cancel stops selecting and clears the ticks', async ({ page }) => {
    await test.step('Given "tiny" and "medium" are ticked', async () => {
      await select(page, 'tiny', 'medium');
    });
    await test.step('When I tap Cancel', async () => {
      await page.getByTestId('selection-cancel').tap();
    });
    await test.step('Then nothing is ticked, the bar is gone, and a tap on "medium" opens it', async () => {
      await expect(page.locator('[aria-checked="true"]')).toHaveCount(0);
      await expect(page.getByTestId('selection-bar')).toBeHidden();
      await tile(page, 'medium').tap();
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
    });
  });

  test('Scenario: playing the selection opens the first ticked video, paused; play asks for Face ID @ipad', async ({ page, faceId }) => {
    await test.step('Given "medium" then "tiny" are ticked', async () => {
      await select(page, 'medium', 'tiny');
    });
    await test.step('When I tap "Play 2"', async () => {
      await expect(page.getByTestId('selection-play')).toHaveText('Play 2');
      await page.getByTestId('selection-play').tap();
    });
    await test.step('Then "medium" is open, paused at the start', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      expect(await isOpen(page, 'medium')).toBe(true);
      await expectNotPlaying(page);
    });
    const before = await faceId.uses();
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').tap();
    });
    await test.step('Then "medium" plays', async () => {
      await expectPlaying(page);
      expect(await faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: at the end of each video the next one plays by itself, without Face ID', async ({ page, faceId }) => {
    await test.step('Given "tiny" (3 s), "Second" (3 s) and "medium" are ticked in that order, and "tiny" is playing', async () => {
      await select(page, 'tiny', 'Second', 'medium');
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
    });
    const uses = await faceId.uses();
    await test.step('When "tiny" ends, then "Second" plays from the start, with no Face ID asked', async () => {
      await expect.poll(() => isOpen(page, 'Second')).toBe(true);
      await expectPlaying(page);
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      expect(await faceId.uses()).toBe(uses);
    });
    await test.step('When "Second" ends, then "medium" plays, with no Face ID asked', async () => {
      await expect.poll(() => isOpen(page, 'medium')).toBe(true);
      await expect(page.getByTestId('time-total')).toHaveText('01:00');
      await expectPlaying(page);
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      expect(await faceId.uses()).toBe(uses);
    });
  });

  test('Scenario: at the end of the last video nothing else starts', async ({ page, faceId }) => {
    await test.step('Given "tiny" then "Second" are playing as a playlist', async () => {
      await select(page, 'tiny', 'Second');
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
    });
    await test.step('When "Second" reaches its end', async () => {
      await expect.poll(() => isOpen(page, 'Second')).toBe(true);
      await expect(playerState(page)).toHaveAttribute('data-state', 'ended');
    });
    await test.step('Then it stays on "Second", stopped', async () => {
      await expectNotPlaying(page);
      expect(await isOpen(page, 'Second')).toBe(true);
    });
    await test.step('And play asks for Face ID, as for any video at its end', async () => {
      const before = await faceId.uses();
      await page.getByTestId('play-button').tap();
      await expect.poll(() => faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: pausing in a playlist is free; resuming needs Face ID and the playlist goes on', async ({ page, faceId }) => {
    await test.step('Given "medium" then "tiny" are playing as a playlist, and I paused "medium"', async () => {
      await select(page, 'medium', 'tiny');
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
      await page.getByTestId('pause-button').tap();
      await expectNotPlaying(page);
    });
    const before = await faceId.uses();
    await test.step('When I tap play, pass Face ID, and "medium" plays to its end', async () => {
      await page.getByTestId('play-button').tap();
      await expectPlaying(page);
      expect(await faceId.uses()).toBe(before + 1);
      await page.getByTestId('seek-bar').fill('58');
    });
    await test.step('Then "tiny" plays next, with no Face ID asked', async () => {
      await expect.poll(() => isOpen(page, 'tiny')).toBe(true);
      await expectPlaying(page);
      await expect(page.getByTestId('unlock-prompt')).toBeHidden();
      expect(await faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: back ends the playlist: the library shows, with nothing playing and nothing ticked', async ({ page }) => {
    await test.step('Given "tiny", "Second" and "medium" are playing as a playlist, and "Second" is on', async () => {
      await select(page, 'tiny', 'Second', 'medium');
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
      await expect.poll(() => isOpen(page, 'Second')).toBe(true);
    });
    await test.step('When I tap back', async () => {
      await page.getByTestId('screen-player').getByTestId('back-button').tap();
    });
    await test.step('Then the library is shown, not selecting, with no video playing', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('screen-library')).not.toHaveAttribute('data-mode', 'select');
      await expect(page.locator('[aria-checked="true"]')).toHaveCount(0);
      const anyPlaying = await page.evaluate(() => [...document.querySelectorAll('video')].some((v) => !v.paused));
      expect(anyPlaying).toBe(false);
    });
  });

  test('Scenario: the back gesture from a later video goes straight to the library', async ({ page }) => {
    await test.step('Given "tiny" then "medium" are playing as a playlist, and "medium" is on', async () => {
      await select(page, 'tiny', 'medium');
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
      await expect.poll(() => isOpen(page, 'medium')).toBe(true);
    });
    await test.step('When I go back (the back gesture)', async () => {
      await page.goBack();
    });
    await test.step('Then the library is shown, not "tiny"', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
    });
  });

  test('Scenario: headphone / lock-screen "next track" does nothing', async ({ page }) => {
    await test.step('Given "medium" then "tiny" are playing as a playlist', async () => {
      await select(page, 'medium', 'tiny');
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
    });
    await test.step('When the device sends "next track"', async () => {
      await mediaSessionAction(page, 'nexttrack');
    });
    await test.step('Then "medium" is still the one playing', async () => {
      await expectPlaying(page);
      expect(await isOpen(page, 'medium')).toBe(true);
    });
  });

  test('Scenario: a video in the playlist that cannot open stops the playlist with its error', async ({ page }) => {
    await test.step('Given "tiny" then "medium" are ticked, and the browser has since deleted "medium" from storage', async () => {
      await select(page, 'tiny', 'medium');
      await page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('shaka_offline_db');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const stores = [...db.objectStoreNames].filter((name) => name.startsWith('manifest'));
          const tx = db.transaction(stores, 'readwrite');
          // Delete only "medium"'s manifest: the one whose title is "medium".
          for (const name of stores) {
            const store = tx.objectStore(name);
            store.openCursor().onsuccess = (e) => {
              const cursor = e.target.result;
              if (!cursor) return;
              if (cursor.value?.appMetadata?.title === 'medium') cursor.delete();
              cursor.continue();
            };
          }
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }));
    });
    await test.step('When the playlist plays and "tiny" ends', async () => {
      await page.getByTestId('selection-play').tap();
      await startPlaying(page);
    });
    await test.step('Then the player shows the error for "medium", with no play button', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'error');
      await expect(page.getByTestId('play-button')).toBeHidden();
    });
  });

  test('Scenario: a selection is not saved: after a reload nothing is ticked', async ({ page }) => {
    await test.step('Given "tiny" and "medium" are ticked', async () => {
      await select(page, 'tiny', 'medium');
    });
    await test.step('When the app reloads', async () => {
      await page.reload();
    });
    await test.step('Then the library is not selecting and nothing is ticked', async () => {
      await expect(page.getByTestId('screen-library')).toHaveAttribute('data-state', 'ready');
      await expect(page.getByTestId('screen-library')).not.toHaveAttribute('data-mode', 'select');
      await expect(page.locator('[aria-checked="true"]')).toHaveCount(0);
    });
  });
});
