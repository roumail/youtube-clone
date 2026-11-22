// Feature: Unlocking with Face ID / Touch ID — the one way a parent unlocks.
// Everything behind the parent (play and resume, Settings, search, adding,
// downloading) unlocks with the device's Face ID or Touch ID; the device falls
// back to its own passcode. The app has no PIN of its own, no lockout and no
// way to switch Face ID off.
// The rules for parents: the child must not know the device passcode, and the
// child's face (or finger) must not be enrolled on the faceId. Failed tries
// are the device's business: after repeated failures it asks for the
// passcode, and wrong passcodes can lock the device itself for a while.
// First run sets up Face ID (a passkey for this app on this device); it can't
// be skipped. A device without Face ID, Touch ID or a passcode can't use the
// app, and says so. Installs from before (with a PIN) set up Face ID on their
// next start, or keep the passkey they already have; the PIN is forgotten.
// While Face ID is asked, only the device's own sheets show. When it fails or
// is cancelled, or play comes from the device (Control Center, the lock
// screen or a keyboard, where Face ID can't start without a tap), the unlock
// prompt shows "Use Face ID" and Cancel. If the passkey is gone (deleted in
// Passwords, or the browser's data cleared), "Set up Face ID again" makes a
// new one, which itself needs Face ID or the device passcode.
// Some actions must start within a tap: the file picker (Add video), and
// Google's sign-in window when a sign-in is due (Add from Google Drive,
// Download, playing a streamed video). Face ID takes a moment, and Safari (iPad) no longer counts the
// tap that asked for it, so after Face ID these wait for a tap on "Continue".
// Signed in already, Google's own picker opens inside the page: no extra tap.
// Chromium doesn't enforce Safari's rule; the iPad is checked by hand.
// Every test runs on a device with Face ID (e2e/support.js): Chromium's
// virtual authenticator here, so these scenarios run in Chromium only.
import {
  test, expect, goto, openVideo, expectPlaying, expectNotPlaying, playerState, mediaSessionAction,
  fakeGoogle, fixtureContainer, sha256Hex,
} from '../../support.js';

const unlockPrompt = (page) => page.getByTestId('unlock-prompt');
const useFaceId = (page) => page.getByTestId('unlock-faceid-button');
const setUpAgain = (page) => page.getByTestId('unlock-faceid-setup-button');
const continueButton = (page) => page.getByTestId('unlock-continue-button');
const cancelButton = (page) => page.getByTestId('unlock-cancel');
const setUpFaceId = (page) => page.getByTestId('setup-faceid-button');
const storedKeys = (page) => page.evaluate(() => Object.keys(localStorage));

// Records whether the unlock prompt is ever on screen from now on.
async function watchPrompt(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="unlock-prompt"]');
    window.promptWasShown = false;
    new MutationObserver(() => { if (!el.hidden) window.promptWasShown = true; })
      .observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
  return { wasShown: () => page.evaluate(() => window.promptWasShown) };
}

// A fresh install, set up with Face ID.
async function setUp(page) {
  await goto(page, '#/library');
  await setUpFaceId(page).click();
  await expect(unlockPrompt(page)).toBeHidden();
  await expect(page.getByTestId('screen-library')).toBeVisible();
}

// An install from before this change: a PIN, and optionally Face ID on with a
// passkey already made (as the PIN-era app stored them).
async function oldInstall(page, { faceId }) {
  await page.addInitScript(([pin]) => {
    if (!localStorage.getItem('pin.sha256')) {
      localStorage.setItem('pin.sha256', pin);
      localStorage.setItem('pin.lockout', JSON.stringify({ failures: 2, until: 0 }));
    }
  }, [sha256Hex('1234')]);
  if (!faceId) return;
  await goto(page, '#/library');
  await page.evaluate(async () => {
    const credential = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Kids videos' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'parent', displayName: 'Parent' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    } });
    const id = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('faceId.credentialId', id);
    localStorage.setItem('features', JSON.stringify({ faceId: true }));
  });
}

test.describe('Feature: Unlocking with Face ID / Touch ID', () => {
  test('Scenario: first run sets up Face ID, with no PIN, and it can\'t be skipped', async ({ page, faceId }) => {
        await test.step('Given a fresh install on a device with Face ID', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then first run offers "Set up Face ID" only: no PIN field, no Cancel', async () => {
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'setup');
      await expect(setUpFaceId(page)).toBeVisible();
      await expect(page.getByTestId('pin-input')).toHaveCount(0);
      await expect(cancelButton(page)).toBeHidden();
    });
    await test.step('When I tap "Set up Face ID" and pass it', async () => {
      await setUpFaceId(page).click();
    });
    await test.step('Then the library is shown, a passkey was made, and no PIN is stored', async () => {
      await expect(unlockPrompt(page)).toBeHidden();
      await expect(page.getByTestId('screen-library')).toBeVisible();
      expect(await faceId.passkeys()).toBe(1);
      expect((await storedKeys(page)).filter((k) => k.startsWith('pin.'))).toEqual([]);
    });
  });

  test('Scenario: if setting up Face ID fails or is cancelled, first run asks again', async ({ page, faceId }) => {
        await test.step('Given a fresh install on a device with Face ID, and Face ID will fail', async () => {
      await goto(page, '#/library');
      await faceId.willFail();
    });
    await test.step('When I tap "Set up Face ID"', async () => {
      await setUpFaceId(page).click();
    });
    await test.step('Then first run still asks to set up Face ID', async () => {
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'setup');
      await expect(setUpFaceId(page)).toBeVisible();
    });
    await test.step('And when it passes this time, the library is shown', async () => {
      await faceId.willPass();
      await setUpFaceId(page).click();
      await expect(unlockPrompt(page)).toBeHidden();
    });
  });

  for (const [action, arrange, act, done] of [
    ['opening Settings', async () => {}, (page) => page.getByTestId('settings-button').click(),
      (page) => expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked')],
    ['playing a video', (page) => openVideo(page, 'tiny'), (page) => page.getByTestId('play-button').tap(),
      (page) => expectPlaying(page)],
    ['typing in search', async () => {}, (page) => page.getByTestId('search-input').click(),
      (page) => expect(page.getByTestId('search-input')).toHaveAttribute('data-state', 'unlocked')],
  ]) {
    test(`Scenario: Face ID unlocks ${action}, and the app shows no prompt`, async ({ page, seedLibrary, faceId }) => {
            await test.step('Given Face ID is set up, and "tiny" is stored', async () => {
        await setUp(page);
        await seedLibrary('tiny');
        await arrange(page);
      });
      const before = await faceId.uses();
      const watched = await watchPrompt(page);
      await test.step(`When I start ${action} and pass Face ID`, async () => {
        await act(page);
      });
      await test.step('Then it goes ahead, and the unlock prompt never showed', async () => {
        await done(page);
        expect(await faceId.uses()).toBe(before + 1);
        expect(await watched.wasShown()).toBe(false);
      });
    });
  }

  test('Scenario: after Face ID, "Add video" waits for a tap on "Continue", which opens the file picker', async ({ page, faceId }) => {
        await test.step('Given Face ID is set up', async () => {
      await setUp(page);
    });
    await test.step('When I tap "Add video" and pass Face ID', async () => {
      await page.getByTestId('add-video-button').click();
    });
    await test.step('Then the prompt shows "Continue"', async () => {
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'continue');
      await expect(continueButton(page)).toBeVisible();
    });
    await test.step('And tapping "Continue" opens the file picker', async () => {
      const chooser = page.waitForEvent('filechooser');
      await continueButton(page).click();
      await chooser;
      await expect(unlockPrompt(page)).toBeHidden();
    });
  });

  test('Scenario: after Face ID, "Add from Google Drive" waits for "Continue" only when a sign-in is due', async ({ page, faceId }) => {
        const google = await fakeGoogle(page, {
      'tiny.kidsvideo': fixtureContainer('tiny'), 'medium.kidsvideo': fixtureContainer('medium'),
    });
    await test.step('Given Face ID is set up, and I am not signed in to Google', async () => {
      await setUp(page);
      await google.willPick('tiny.kidsvideo');
    });
    await test.step('When I tap "Add from Google Drive" and pass Face ID', async () => {
      await page.getByTestId('add-from-drive-button').click();
    });
    await test.step('Then "Continue" shows, and Google\'s sign-in is asked only on that tap', async () => {
      await expect(continueButton(page)).toBeVisible();
      expect(await google.signIns()).toBe(0);
      await continueButton(page).click();
      await expect(page.getByTestId('import-status').filter({ hasText: 'Added "tiny".' })).toBeVisible();
      expect(await google.signIns()).toBe(1);
    });
    await test.step('And signed in now, adding again needs no "Continue"', async () => {
      await google.willPick('medium.kidsvideo');
      await page.getByTestId('add-from-drive-button').click();
      await expect(page.getByTestId('import-status').filter({ hasText: 'Added "medium".' })).toBeVisible();
      await expect(continueButton(page)).toBeHidden();
      expect(await google.signIns()).toBe(1);
    });
  });

  test('Scenario: when Face ID fails or is cancelled, the prompt offers "Use Face ID" again, and no PIN', async ({ page, faceId }) => {
        await test.step('Given Face ID is set up, and it will fail', async () => {
      await setUp(page);
      await faceId.willFail();
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the unlock prompt shows "Use Face ID" and Cancel, and Settings stays locked', async () => {
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'unlock');
      await expect(useFaceId(page)).toBeVisible();
      await expect(cancelButton(page)).toBeVisible();
      await expect(page.getByTestId('pin-input')).toHaveCount(0);
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'locked');
    });
    await test.step('And when I tap "Use Face ID" and it passes this time, Settings opens', async () => {
      await faceId.willPass();
      await useFaceId(page).click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });

  test('Scenario: Face ID failing many times does not lock the app; the device handles failed tries', async ({ page, faceId }) => {
        await test.step('Given Face ID is set up, it will fail, and I tapped Settings', async () => {
      await setUp(page);
      await faceId.willFail();
      await page.getByTestId('settings-button').click();
    });
    await test.step('When Face ID fails 5 more times', async () => {
      for (let i = 0; i < 5; i++) await useFaceId(page).click();
    });
    await test.step('Then "Use Face ID" can still be tapped, and passing it opens Settings', async () => {
      await faceId.willPass();
      await expect(useFaceId(page)).toBeEnabled();
      await useFaceId(page).click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });

  test('Scenario: Cancel closes the prompt, and nothing is unlocked', async ({ page, faceId }) => {
        await test.step('Given Face ID is set up, it failed after tapping Settings, and the prompt shows', async () => {
      await setUp(page);
      await faceId.willFail();
      await page.getByTestId('settings-button').click();
      await expect(unlockPrompt(page)).toBeVisible();
    });
    await test.step('When I tap Cancel', async () => {
      await cancelButton(page).click();
    });
    await test.step('Then the prompt closes, and the library is shown', async () => {
      await expect(unlockPrompt(page)).toBeHidden();
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('screen-settings')).toBeHidden();
    });
  });

  test('Scenario: play from the device waits for a tap on "Use Face ID"', async ({ page, seedLibrary, faceId }) => {
        await test.step('Given Face ID is set up, and "tiny" is open', async () => {
      await setUp(page);
      await seedLibrary('tiny');
      await openVideo(page, 'tiny');
    });
    const before = await faceId.uses();
    await test.step('When play comes from the device (Control Center, lock screen or a keyboard)', async () => {
      await mediaSessionAction(page, 'play');
    });
    await test.step('Then the unlock prompt shows "Use Face ID", and Face ID is not asked yet', async () => {
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'unlock');
      await expect(useFaceId(page)).toBeVisible();
      await expectNotPlaying(page);
      expect(await faceId.uses()).toBe(before);
    });
    await test.step('And when I tap "Use Face ID" and pass it, the video plays', async () => {
      await useFaceId(page).tap();
      await expectPlaying(page);
    });
  });

  test('Scenario: if the passkey was deleted, "Set up Face ID again" makes a new one that works', async ({ page, faceId }) => {
        await test.step('Given Face ID is set up, and its passkey was then deleted (e.g. in Passwords)', async () => {
      await setUp(page);
      await faceId.deletePasskeys();
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the unlock prompt offers "Set up Face ID again"', async () => {
      await expect(setUpAgain(page)).toBeVisible();
    });
    await test.step('And when I tap it and pass Face ID, Settings opens, and the new passkey unlocks next time', async () => {
      await setUpAgain(page).click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
      expect(await faceId.passkeys()).toBe(1);
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
  });

  test('Scenario: if the device refuses to start playback after Face ID, Play shows again', async ({ page, seedLibrary, faceId }) => {
        await test.step('Given Face ID is set up, "tiny" is open, and the device will refuse the next start of playback', async () => {
      await setUp(page);
      await seedLibrary('tiny');
      await openVideo(page, 'tiny');
      await page.evaluate(() => {
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          HTMLMediaElement.prototype.play = play;
          return Promise.reject(new DOMException('The request is not allowed by the user agent.', 'NotAllowedError'));
        };
      });
    });
    await test.step('When I tap play and pass Face ID', async () => {
      await page.getByTestId('play-button').tap();
    });
    await test.step('Then the video is paused, with the play button showing', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('play-button')).toBeVisible();
      await expectNotPlaying(page);
    });
    await test.step('And tapping play and passing Face ID again plays it', async () => {
      await page.getByTestId('play-button').tap();
      await expectPlaying(page);
    });
  });

  test('Scenario: Settings has nothing about a PIN or switching Face ID', async ({ page, faceId }) => {
        await test.step('Given Face ID is set up, and Settings is open', async () => {
      await setUp(page);
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
    });
    await test.step('Then there is no "Change PIN", no "Remove PIN" and no Face ID switch', async () => {
      await expect(page.getByTestId('change-pin-button')).toHaveCount(0);
      await expect(page.getByTestId('remove-pin-button')).toHaveCount(0);
      await expect(page.getByTestId('feature-toggle-faceId')).toHaveCount(0);
    });
  });

  test('Scenario: an install from before, with a PIN only, sets up Face ID on its next start and forgets the PIN', async ({ page, faceId }) => {
        await test.step('Given an install with a PIN and Face ID off', async () => {
      await oldInstall(page, { faceId: false });
      await goto(page, '#/library');
    });
    await test.step('Then it asks to set up Face ID, and it can\'t be skipped', async () => {
      await expect(unlockPrompt(page)).toHaveAttribute('data-mode', 'setup');
      await expect(cancelButton(page)).toBeHidden();
    });
    await test.step('And once Face ID is set up, the PIN and its lockout are gone, and Face ID unlocks', async () => {
      await setUpFaceId(page).click();
      await expect(unlockPrompt(page)).toBeHidden();
      expect((await storedKeys(page)).filter((k) => k.startsWith('pin.'))).toEqual([]);
      const before = await faceId.uses();
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
      expect(await faceId.uses()).toBe(before + 1);
    });
  });

  test('Scenario: an install from before, with a PIN and Face ID on, keeps its passkey and forgets the PIN', async ({ page, faceId }) => {
        await test.step('Given an install with a PIN and Face ID on', async () => {
      await oldInstall(page, { faceId: true });
    });
    await test.step('When it starts', async () => {
      await page.reload();
    });
    await test.step('Then nothing is asked, the PIN is gone, and the same passkey unlocks Settings', async () => {
      await expect(unlockPrompt(page)).toBeHidden();
      await expect(page.getByTestId('screen-library')).toBeVisible();
      expect((await storedKeys(page)).filter((k) => k.startsWith('pin.'))).toEqual([]);
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toHaveAttribute('data-state', 'unlocked');
      expect(await faceId.passkeys()).toBe(1);
    });
  });
});

test.describe('Feature: Unlocking with Face ID / Touch ID, on a device without it', () => {
  test.use({ faceIdDevice: false });

  test('Scenario: a device without Face ID, Touch ID or a passcode says the app can\'t be used on it', async ({ page }) => {
    await test.step('Given a fresh install on a device without Face ID, Touch ID or a passcode', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then it says so, and offers nothing to set up', async () => {
      await expect(page.getByTestId('unlock-unavailable')).toBeVisible();
      await expect(setUpFaceId(page)).toBeHidden();
    });
  });
});
