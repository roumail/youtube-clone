// Feature: Face ID / Touch ID instead of a PIN — on a device with Face ID or
// Touch ID, first run sets up Face ID, and no PIN is needed. A parent can
// still choose a PIN instead (on first run, or later in Settings). Without a
// PIN, every action behind the PIN unlocks with Face ID alone: the device's
// own sheets show, and nothing of the app's (face-id.spec.js says how).
// Face ID can only start from a tap on the screen, so when it fails, is
// cancelled, or play comes from the device (Control Center, the lock screen
// or a keyboard), the unlock prompt shows without a PIN field and waits for a
// tap on "Use Face ID". If the passkey is gone (deleted in Passwords, or the
// browser's data cleared), "Set up Face ID again" makes a new one, which
// itself needs Face ID or the device passcode.
// Three ways to unlock, then: a PIN (devices without Face ID, or a parent's
// choice), a PIN with Face ID (face-id.spec.js), or Face ID alone (this file).
// Installs that already have a PIN keep it, with their Face ID setting.
// Devices without Face ID or Touch ID set a PIN on first run, as before
// (set-pin.spec.js). Face ID is a virtual authenticator (Chromium's WebAuthn
// DevTools domain), so these scenarios run in Chromium only.
import {
  test, expect, goto, enterPin, openVideo, expectPlaying, expectNotPlaying, PIN, sha256Hex,
  mediaSessionAction,
} from '../../support.js';

// A device with Face ID: a platform authenticator that passes unless told to fail.
async function faceIdDevice(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  const credentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  return {
    willFail: () => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false }),
    willPass: () => cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true }),
    passkeys: async () => (await credentials()).length,
    uses: async () => (await credentials()).reduce((n, c) => n + c.signCount, 0),
    deletePasskeys: () => cdp.send('WebAuthn.clearCredentials', { authenticatorId }),
  };
}

// WebAuthn needs a host name, not an IP address.
test.use({ baseURL: 'http://localhost:4173/app/' });

const prompt = (page) => page.getByTestId('pin-prompt');
const pinInput = (page) => page.getByTestId('pin-input');
const faceIdButton = (page) => page.getByTestId('pin-faceid-button');
const faceIdAgainButton = (page) => page.getByTestId('pin-faceid-setup-button');
const setupFaceId = (page) => page.getByTestId('setup-faceid-button');
const setupPin = (page) => page.getByTestId('setup-pin-button');
const toggle = (page) => page.getByTestId('feature-toggle-faceId');
const storedPin = (page) => page.evaluate(() => localStorage.getItem('pin.sha256'));

// Records whether the unlock prompt is ever on screen from now on.
async function watchPrompt(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="pin-prompt"]');
    window.promptWasShown = false;
    new MutationObserver(() => { if (!el.hidden) window.promptWasShown = true; })
      .observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
  return { wasShown: () => page.evaluate(() => window.promptWasShown) };
}

// A fresh install on a device with Face ID, set up with Face ID alone.
async function faceIdOnly(page) {
  await goto(page, '#/library');
  await setupFaceId(page).click();
  await expect(page.getByTestId('screen-library')).toBeVisible();
}

test.describe('Feature: Face ID / Touch ID instead of a PIN', () => {
  test.fixme('Scenario: on first run, a device with Face ID sets up Face ID, and no PIN is asked', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given a fresh install on a device with Face ID', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then first run offers "Set up Face ID", and "Use a PIN instead"', async () => {
      await expect(setupFaceId(page)).toBeVisible();
      await expect(setupPin(page)).toBeVisible();
      await expect(pinInput(page)).toBeHidden();
    });
    await test.step('When I tap "Set up Face ID" and pass it', async () => {
      await setupFaceId(page).click();
    });
    await test.step('Then the library is shown, Face ID is on, and no PIN is stored', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      expect(await device.passkeys()).toBe(1);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('features')).faceId)).toBe(true);
      expect(await storedPin(page)).toBeNull();
    });
  });

  test.fixme('Scenario: on first run, "Use a PIN instead" sets a PIN as before, with Face ID off', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given a fresh install on a device with Face ID', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap "Use a PIN instead", and enter and confirm "2468"', async () => {
      await setupPin(page).click();
      await expect(prompt(page)).toHaveAttribute('data-mode', 'setup');
      await enterPin(page, '2468');
      await enterPin(page, '2468');
    });
    await test.step('Then the library is shown, the PIN is set, and no passkey was made', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      expect(await storedPin(page)).toBe(sha256Hex('2468'));
      expect(await device.passkeys()).toBe(0);
    });
  });

  test.fixme('Scenario: if setting up Face ID on first run fails or is cancelled, first run offers both again', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given a fresh install on a device with Face ID, and Face ID will fail', async () => {
      await goto(page, '#/library');
      await device.willFail();
    });
    await test.step('When I tap "Set up Face ID"', async () => {
      await setupFaceId(page).click();
    });
    await test.step('Then nothing is set up, and both choices are offered again', async () => {
      await expect(setupFaceId(page)).toBeVisible();
      await expect(setupPin(page)).toBeVisible();
      await expect(page.getByTestId('screen-library')).toBeHidden();
      expect(await storedPin(page)).toBeNull();
    });
  });

  for (const [action, arrange, act, done] of [
    ['opening Settings', async () => {}, (page) => page.getByTestId('settings-button').click(),
      (page) => expect(page.getByTestId('screen-settings')).toBeVisible()],
    ['playing a video', (page) => openVideo(page, 'tiny'), (page) => page.getByTestId('play-button').tap(),
      (page) => expectPlaying(page)],
    ['typing in search', async () => {}, (page) => page.getByTestId('search-input').click(),
      (page) => expect(page.getByTestId('search-input')).toHaveAttribute('data-state', 'unlocked')],
  ]) {
    test.fixme(`Scenario: with Face ID alone, Face ID unlocks ${action}, and the app shows no prompt`, async ({ page, seedLibrary }) => {
      const device = await faceIdDevice(page);
      await test.step('Given Face ID alone is set up, and "tiny" is stored', async () => {
        await faceIdOnly(page);
        await seedLibrary('tiny');
        await arrange(page);
      });
      const before = await device.uses();
      const watched = await watchPrompt(page);
      await test.step(`When I start ${action} and pass Face ID`, async () => {
        await act(page);
      });
      await test.step('Then it goes ahead, and the unlock prompt never showed', async () => {
        await done(page);
        expect(await device.uses()).toBe(before + 1);
        expect(await watched.wasShown()).toBe(false);
      });
    });
  }

  test.fixme('Scenario: with Face ID alone, a failed or cancelled Face ID shows the prompt without a PIN field, and Face ID can be tried again', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID alone is set up, and Face ID will fail', async () => {
      await faceIdOnly(page);
      await device.willFail();
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the unlock prompt shows "Use Face ID" and no PIN field, and Settings stays locked', async () => {
      await expect(prompt(page)).toBeVisible();
      await expect(prompt(page)).toHaveAttribute('data-mode', 'faceid');
      await expect(faceIdButton(page)).toBeVisible();
      await expect(pinInput(page)).toBeHidden();
      await expect(page.getByTestId('screen-settings')).toBeHidden();
    });
    await test.step('And when I tap "Use Face ID" and it passes this time, Settings opens', async () => {
      await device.willPass();
      await faceIdButton(page).click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test.fixme('Scenario: with Face ID alone, Cancel closes the prompt and nothing is unlocked', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID alone is set up, Face ID failed, and the unlock prompt shows', async () => {
      await faceIdOnly(page);
      await device.willFail();
      await page.getByTestId('settings-button').click();
      await expect(prompt(page)).toBeVisible();
    });
    await test.step('When I tap Cancel', async () => {
      await page.getByTestId('pin-cancel').click();
    });
    await test.step('Then the prompt closes, and the library is shown, Settings locked', async () => {
      await expect(prompt(page)).toBeHidden();
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(page.getByTestId('screen-settings')).toBeHidden();
    });
  });

  test.fixme('Scenario: with Face ID alone, play from the device waits for a tap on "Use Face ID"', async ({ page, seedLibrary }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID alone is set up, and "tiny" is open', async () => {
      await faceIdOnly(page);
      await seedLibrary('tiny');
      await openVideo(page, 'tiny');
    });
    const before = await device.uses();
    await test.step('When play comes from the device (Control Center, lock screen or a keyboard)', async () => {
      await mediaSessionAction(page, 'play');
    });
    await test.step('Then the unlock prompt shows "Use Face ID", and Face ID is not asked yet', async () => {
      await expect(prompt(page)).toBeVisible();
      await expect(faceIdButton(page)).toBeVisible();
      await expect(pinInput(page)).toBeHidden();
      await expectNotPlaying(page);
      expect(await device.uses()).toBe(before);
    });
    await test.step('And when I tap "Use Face ID" and pass it, the video plays', async () => {
      await faceIdButton(page).tap();
      await expectPlaying(page);
    });
  });

  test.fixme('Scenario: with Face ID alone, if the passkey was deleted, "Set up Face ID again" makes a new one that works', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID alone is set up, and its passkey was then deleted (e.g. in Passwords)', async () => {
      await faceIdOnly(page);
      await device.deletePasskeys();
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the unlock prompt offers "Set up Face ID again"', async () => {
      await expect(prompt(page)).toHaveAttribute('data-mode', 'faceid');
      await expect(faceIdAgainButton(page)).toBeVisible();
    });
    await test.step('And when I tap it and pass Face ID, Settings opens, and the new passkey unlocks next time', async () => {
      await faceIdAgainButton(page).click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
      expect(await device.passkeys()).toBe(1);
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test.fixme('Scenario: with Face ID alone, Settings offers "Set a PIN", and the PIN then works when Face ID fails', async ({ page }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID alone is set up, and Settings is open', async () => {
      await faceIdOnly(page);
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
    await test.step('When I tap "Set a PIN", and enter and confirm "2468"', async () => {
      await expect(page.getByTestId('change-pin-button')).toHaveText('Set a PIN');
      await page.getByTestId('change-pin-button').click();
      await enterPin(page, '2468');
      await enterPin(page, '2468');
    });
    await test.step('Then the PIN is set, and Face ID stays on', async () => {
      expect(await storedPin(page)).toBe(sha256Hex('2468'));
      await expect(toggle(page)).toBeChecked();
    });
    await test.step('And when Face ID fails, the PIN opens Settings', async () => {
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await device.willFail();
      await page.getByTestId('settings-button').click();
      await expect(pinInput(page)).toBeVisible();
      await enterPin(page, '2468');
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test.fixme('Scenario: with Face ID alone, switching Face ID off first asks for a new PIN', async ({ page }) => {
    await faceIdDevice(page);
    await test.step('Given Face ID alone is set up, and Settings is open', async () => {
      await faceIdOnly(page);
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
    await test.step('When I switch Face ID off', async () => {
      await toggle(page).uncheck();
    });
    await test.step('Then a new PIN is asked first; cancelling it keeps Face ID on', async () => {
      await expect(prompt(page)).toHaveAttribute('data-mode', 'change');
      await page.getByTestId('pin-cancel').click();
      await expect(toggle(page)).toBeChecked();
      expect(await storedPin(page)).toBeNull();
    });
    await test.step('And setting the PIN switches Face ID off, and the PIN unlocks from then on', async () => {
      await toggle(page).uncheck();
      await enterPin(page, '2468');
      await enterPin(page, '2468');
      await expect(toggle(page)).not.toBeChecked();
      expect(await storedPin(page)).toBe(sha256Hex('2468'));
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await page.getByTestId('settings-button').click();
      await enterPin(page, '2468');
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test.fixme('Scenario: with a PIN and Face ID on, "Remove PIN" in Settings leaves Face ID alone', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given a PIN is set, Face ID is on, and Settings is open', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
      await toggle(page).check();
      await expect(toggle(page)).toBeChecked();
    });
    await test.step('When I tap "Remove PIN" and pass Face ID', async () => {
      await page.getByTestId('remove-pin-button').click();
    });
    await test.step('Then no PIN is stored, and a failed Face ID shows no PIN field', async () => {
      await expect.poll(() => storedPin(page)).toBeNull();
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await device.willFail();
      await page.getByTestId('settings-button').click();
      await expect(prompt(page)).toHaveAttribute('data-mode', 'faceid');
      await expect(pinInput(page)).toBeHidden();
    });
  });

  test.fixme('Scenario: "Remove PIN" is offered only while Face ID is on', async ({ page, pinSet }) => {
    await faceIdDevice(page);
    await test.step('Given a PIN is set, Face ID is off, and Settings is open', async () => {
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
    await test.step('Then there is no "Remove PIN"', async () => {
      await expect(page.getByTestId('remove-pin-button')).toBeHidden();
    });
  });

  test.fixme('Scenario: an install that already has a PIN keeps it, with no first-run choice', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given a PIN is set, Face ID is off, on a device with Face ID', async () => {
      await goto(page, '#/library');
    });
    await test.step('Then the library is shown, and opening Settings asks for the PIN', async () => {
      await expect(page.getByTestId('screen-library')).toBeVisible();
      await expect(setupFaceId(page)).toBeHidden();
      await page.getByTestId('settings-button').click();
      await expect(pinInput(page)).toBeVisible();
      expect(await device.passkeys()).toBe(0);
    });
  });
});
