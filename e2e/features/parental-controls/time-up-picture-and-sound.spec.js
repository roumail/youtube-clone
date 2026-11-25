// Feature: "Time is up" picture and sound — part of the watch-time limit
// (watch-time-limit.spec.js). When the budget runs out, the player shows
// "Time is up" with a picture the parent chose, if any, and plays a little
// background tune: a built-in one, or a sound file the parent chose instead.
// Both are chosen in Settings (behind Face ID) and kept on this device only,
// like the videos: nothing personal goes into the app or the repo.
// The built-in tune is a short, gentle music-box melody (about 10 seconds,
// original), synthesized by the app (no media file). It plays once, at the
// device's volume (hardware buttons only).
// Not built yet.
import {
  test, expect, goto, openVideo, expectNotPlaying, playerState, tapContinue,
} from '../../support.js';

// A 1×1 GIF, and a 1-second 440 Hz WAV: what a parent might pick.
const PICTURE = {
  name: 'hearts.gif', mimeType: 'image/gif',
  buffer: Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'),
};
function wav(seconds = 1, rate = 8000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}
const SOUND = { name: 'our-song.wav', mimeType: 'audio/wav', buffer: wav() };
const NOT_A_PICTURE = { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') };

const sound = (page) => page.getByTestId('time-up-sound');
const picture = (page) => page.getByTestId('time-up-picture');

// The watch-time limit on, with 1 second of budget left (as in watch-time-limit.spec.js).
async function oneSecondLeft(page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('features')) localStorage.setItem('features', JSON.stringify({ watchTimeLimit: true }));
    localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 1799 }));
  });
}

// "medium" open and played until the budget runs out.
async function runOutOfTime(page) {
  await openVideo(page, 'medium');
  await page.getByTestId('play-button').click();
  await expect(playerState(page)).toHaveAttribute('data-state', 'time-up');
  await expectNotPlaying(page);
}

// A sound "played": its media time advanced (it may have ended since).
async function expectSoundPlayed(page) {
  await expect.poll(() => sound(page).evaluate((a) => (a.played.length ? a.played.end(0) : 0))).toBeGreaterThan(0);
}

// Settings, unlocked with Face ID.
async function openSettings(page) {
  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
}

// Pick a file with one of the "Time is up" choose buttons (Continue after Face ID if asked).
async function choose(page, button, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(button).click();
  if (await page.getByTestId('unlock-prompt').isVisible()) await tapContinue(page);
  await (await chooser).setFiles(file);
}

test.use({ features: null });

test.describe('Feature: "Time is up" picture and sound', () => {
  test.fixme('Scenario: by default, "Time is up" plays the built-in tune once, with no picture @ipad', async ({ page, setUp, seedLibrary }) => {
    await oneSecondLeft(page);
    await test.step('Given nobody chose a picture or a sound, and "medium" is in the library', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
    });
    await test.step('When the budget runs out while "medium" plays', async () => {
      await runOutOfTime(page);
    });
    await test.step('Then the built-in tune plays, once', async () => {
      await expect(sound(page)).toHaveAttribute('data-sound', 'built-in');
      await expectSoundPlayed(page);
      expect(await sound(page).evaluate((a) => a.loop)).toBe(false);
    });
    await test.step('And no picture is shown', async () => {
      await expect(picture(page)).toBeHidden();
    });
  });

  test.fixme('Scenario: a picture chosen in Settings shows with "Time is up"', async ({ page, setUp, seedLibrary }) => {
    await oneSecondLeft(page);
    await test.step('Given settings is unlocked with Face ID', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openSettings(page);
    });
    await test.step('When I choose "hearts.gif" as the "Time is up" picture', async () => {
      await choose(page, 'time-up-picture-choose', PICTURE);
    });
    await test.step('Then Settings shows it', async () => {
      await expect(page.getByTestId('time-up-picture-preview')).toBeVisible();
    });
    await test.step('When the budget runs out while "medium" plays', async () => {
      await goto(page, '#/library');
      await runOutOfTime(page);
    });
    await test.step('Then the picture shows with "Time is up"', async () => {
      await expect(picture(page)).toBeVisible();
      expect(await picture(page).evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    });
  });

  test.fixme('Scenario: the picture and the sound are kept on this device after a reload', async ({ page, setUp, seedLibrary }) => {
    await oneSecondLeft(page);
    await test.step('Given I chose a picture and a sound in Settings', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openSettings(page);
      await choose(page, 'time-up-picture-choose', PICTURE);
      await choose(page, 'time-up-sound-choose', SOUND);
    });
    await test.step('When I reload the app and the budget runs out', async () => {
      await page.reload();
      await goto(page, '#/library');
      await runOutOfTime(page);
    });
    await test.step('Then my picture shows and my sound plays', async () => {
      await expect(picture(page)).toBeVisible();
      await expect(sound(page)).toHaveAttribute('data-sound', 'own');
      await expectSoundPlayed(page);
    });
  });

  test.fixme('Scenario: removing the picture shows "Time is up" without one again', async ({ page, setUp, seedLibrary }) => {
    await oneSecondLeft(page);
    await test.step('Given I chose a picture in Settings', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openSettings(page);
      await choose(page, 'time-up-picture-choose', PICTURE);
    });
    await test.step('When I remove it', async () => {
      await page.getByTestId('time-up-picture-remove').click();
    });
    await test.step('Then Settings shows no picture', async () => {
      await expect(page.getByTestId('time-up-picture-preview')).toBeHidden();
    });
    await test.step('And when the budget runs out, no picture is shown', async () => {
      await goto(page, '#/library');
      await runOutOfTime(page);
      await expect(picture(page)).toBeHidden();
    });
  });

  test.fixme('Scenario: a sound chosen in Settings plays instead of the built-in tune @ipad', async ({ page, setUp, seedLibrary }) => {
    await oneSecondLeft(page);
    await test.step('Given settings is unlocked with Face ID', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openSettings(page);
    });
    await test.step('When I choose "our-song.wav" as the "Time is up" sound', async () => {
      await choose(page, 'time-up-sound-choose', SOUND);
    });
    await test.step('Then Settings names it', async () => {
      await expect(page.getByTestId('time-up-sound-name')).toHaveText('our-song.wav');
    });
    await test.step('When the budget runs out while "medium" plays', async () => {
      await goto(page, '#/library');
      await runOutOfTime(page);
    });
    await test.step('Then my sound plays, not the built-in tune', async () => {
      await expect(sound(page)).toHaveAttribute('data-sound', 'own');
      await expectSoundPlayed(page);
    });
  });

  test.fixme('Scenario: going back to the built-in tune', async ({ page, setUp, seedLibrary }) => {
    await oneSecondLeft(page);
    await test.step('Given I chose my own sound in Settings', async () => {
      await goto(page, '#/library');
      await seedLibrary('medium');
      await openSettings(page);
      await choose(page, 'time-up-sound-choose', SOUND);
    });
    await test.step('When I tap "Use the built-in tune"', async () => {
      await page.getByTestId('time-up-sound-reset').click();
    });
    await test.step('Then Settings shows the built-in tune', async () => {
      await expect(page.getByTestId('time-up-sound-name')).toHaveText('Built-in tune');
    });
    await test.step('And when the budget runs out, the built-in tune plays', async () => {
      await goto(page, '#/library');
      await runOutOfTime(page);
      await expect(sound(page)).toHaveAttribute('data-sound', 'built-in');
      await expectSoundPlayed(page);
    });
  });

  test.fixme('Scenario: a file that isn\'t a picture or a sound is refused, and the choice stays as it was', async ({ page, setUp }) => {
    await test.step('Given settings is unlocked with Face ID, with no picture and the built-in tune', async () => {
      await goto(page, '#/library');
      await openSettings(page);
    });
    await test.step('When I pick "notes.txt" as the picture, then as the sound', async () => {
      await choose(page, 'time-up-picture-choose', NOT_A_PICTURE);
      await expect(page.getByTestId('time-up-picture-status')).toHaveAttribute('data-state', 'refused');
      await choose(page, 'time-up-sound-choose', NOT_A_PICTURE);
      await expect(page.getByTestId('time-up-sound-status')).toHaveAttribute('data-state', 'refused');
    });
    await test.step('Then there is still no picture, and the sound is still the built-in tune', async () => {
      await expect(page.getByTestId('time-up-picture-preview')).toBeHidden();
      await expect(page.getByTestId('time-up-sound-name')).toHaveText('Built-in tune');
    });
  });

  test.fixme('Scenario: pausing or reaching the end of a video shows no picture and plays no sound', async ({ page, setUp, seedLibrary }) => {
    await test.step('Given I chose a picture, and "tiny" is playing with time left', async () => {
      await page.addInitScript(() => localStorage.setItem('watchTime.session', JSON.stringify({ budget: 1800, used: 0 })));
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await openSettings(page);
      await choose(page, 'time-up-picture-choose', PICTURE);
      await goto(page, '#/library');
      await openVideo(page, 'tiny');
      await page.getByTestId('play-button').click();
    });
    await test.step('When it plays to the end', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'ended');
    });
    await test.step('Then no picture is shown and no sound played', async () => {
      await expect(picture(page)).toBeHidden();
      expect(await sound(page).evaluate((a) => a.played.length)).toBe(0);
    });
  });
});
