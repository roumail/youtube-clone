// Feature: Face ID / Touch ID — an optional parental feature behind a flag,
// off by default and switched in Settings. When on, the PIN prompt starts
// Face ID (Touch ID on a Mac) as soon as it opens; passing it answers the
// prompt exactly like the right PIN. It lives in the PIN prompt alone: every
// action behind the PIN gets it the same way, with no exceptions per action.
// The PIN stays: it is typed whenever Face ID fails or is cancelled, and the
// prompt's rules (lockout, setup, changing the PIN) don't change.
// Switching it on sets up a passkey for this app on this device; switching it
// off forgets it. Devices without Face ID / Touch ID don't offer it.
// Face ID is a virtual authenticator (Chromium's WebAuthn DevTools domain), so
// these scenarios run in Chromium only. Whether a refused start of playback
// after Face ID happens on a real iPad is checked by hand; the app handles it
// as it does after the PIN (play-requires-pin.spec.js).
import {
  test, expect, goto, enterPin, openVideo, expectPlaying, expectNotPlaying, playerState, PIN,
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
    // How often Face ID was passed with this app's passkey.
    uses: async () => (await credentials()).reduce((n, c) => n + c.signCount, 0),
    deletePasskeys: () => cdp.send('WebAuthn.clearCredentials', { authenticatorId }),
  };
}

// WebAuthn needs a host name, not an IP address: these scenarios open the test
// server (playwright.config.js, port 4173) as localhost instead of 127.0.0.1.
test.use({ baseURL: 'http://localhost:4173/app/' });

const prompt = (page) => page.getByTestId('pin-prompt');
const faceIdButton = (page) => page.getByTestId('pin-faceid-button');
const toggle = (page) => page.getByTestId('feature-toggle-faceId');

async function openSettings(page) {
  await page.getByTestId('settings-button').click();
  await enterPin(page, PIN);
  await expect(page.getByTestId('screen-settings')).toBeVisible();
}

async function switchFaceIdOn(page) {
  await openSettings(page);
  await toggle(page).check();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('features')).faceId)).toBe(true);
  await expect(toggle(page)).toBeChecked();
  await page.getByTestId('screen-settings').getByTestId('back-button').click();
}

test.describe('Feature: Face ID / Touch ID (optional)', () => {
  test('Scenario: off by default: the PIN prompt asks for the PIN only', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given a fresh install on a device with Face ID', async () => {
      await goto(page, '#/library');
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the PIN prompt shows, without Face ID, and Face ID was never asked', async () => {
      await expect(prompt(page)).toBeVisible();
      await expect(faceIdButton(page)).toBeHidden();
      expect(await device.passkeys()).toBe(0);
    });
  });

  test('Scenario: switching it on in Settings sets up Face ID, and it sticks', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Settings is unlocked with the PIN', async () => {
      await goto(page, '#/library');
      await openSettings(page);
    });
    await test.step('When I switch on "Face ID / Touch ID" and pass Face ID', async () => {
      await toggle(page).check();
    });
    await test.step('Then it is on, with one passkey for this app on this device', async () => {
      await expect(toggle(page)).toBeChecked();
      await expect.poll(() => device.passkeys()).toBe(1);
    });
    await test.step('And after a reload it is still on, and Face ID opens Settings', async () => {
      await page.reload();
      await goto(page, '#/library');
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
      await expect(toggle(page)).toBeChecked();
    });
  });

  test('Scenario: if setting it up fails or is cancelled, it stays off', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Settings is unlocked, and Face ID will fail', async () => {
      await goto(page, '#/library');
      await openSettings(page);
      await device.willFail();
    });
    await test.step('When I switch on "Face ID / Touch ID"', async () => {
      await toggle(page).click();
    });
    await test.step('Then it is still off', async () => {
      await expect(toggle(page)).not.toBeChecked();
      expect(JSON.parse(await page.evaluate(() => localStorage.getItem('features'))).faceId ?? false).toBe(false);
    });
  });

  // One rule for every action behind the PIN: the prompt starts Face ID, and
  // passing it does what the right PIN would.
  for (const [action, arrange, act, done] of [
    ['opening Settings', async () => {}, (page) => page.getByTestId('settings-button').click(),
      (page) => expect(page.getByTestId('screen-settings')).toBeVisible()],
    ['playing a video', (page) => openVideo(page, 'tiny'), (page) => page.getByTestId('play-button').tap(),
      (page) => expectPlaying(page)],
    ['typing in search', async () => {}, (page) => page.getByTestId('search-input').click(),
      (page) => expect(page.getByTestId('search-input')).toHaveAttribute('data-state', 'unlocked')],
  ]) {
    test(`Scenario: with it on, Face ID answers the PIN prompt for ${action}`, async ({ page, pinSet, seedLibrary }) => {
      const device = await faceIdDevice(page);
      await test.step('Given Face ID is on, and "tiny" is stored', async () => {
        await goto(page, '#/library');
        await seedLibrary('tiny');
        await switchFaceIdOn(page);
        await arrange(page);
      });
      const before = await device.uses();
      await test.step(`When I start ${action} and pass Face ID`, async () => {
        await act(page);
      });
      await test.step('Then it goes ahead without the PIN being typed', async () => {
        await done(page);
        await expect(prompt(page)).toBeHidden();
        expect(await device.uses()).toBe(before + 1);
      });
    });
  }

  test('Scenario: when Face ID fails or is cancelled, the PIN still works, and Face ID can be tried again', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID is on, and it will fail', async () => {
      await goto(page, '#/library');
      await switchFaceIdOn(page);
      await device.willFail();
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the PIN prompt stays open, offering Face ID again', async () => {
      await expect(prompt(page)).toBeVisible();
      await expect(faceIdButton(page)).toBeVisible();
    });
    await test.step('And when I tap "Use Face ID" and it passes this time, Settings opens', async () => {
      await device.willPass();
      await faceIdButton(page).click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test('Scenario: a failed Face ID is not a wrong PIN', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID is on, and it will fail', async () => {
      await goto(page, '#/library');
      await switchFaceIdOn(page);
      await device.willFail();
      await page.getByTestId('settings-button').click();
    });
    await test.step('When Face ID fails 5 times', async () => {
      for (let i = 1; i < 5; i++) await faceIdButton(page).click();
    });
    await test.step('Then the prompt is not locked out, and the right PIN opens Settings', async () => {
      await expect(prompt(page)).not.toHaveAttribute('data-state', 'locked-out');
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test('Scenario: during a lockout Face ID is not offered either', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID is on, and the PIN prompt is locked out after 5 wrong PINs', async () => {
      await goto(page, '#/library');
      await switchFaceIdOn(page);
      await device.willFail();
      await page.getByTestId('settings-button').click();
      for (let i = 0; i < 5; i++) await enterPin(page, '0000');
      await expect(prompt(page)).toHaveAttribute('data-state', 'locked-out');
    });
    const before = await device.uses();
    await test.step('Then "Use Face ID" can\'t be tapped, and Face ID is not asked', async () => {
      await device.willPass();
      await expect(faceIdButton(page)).toBeDisabled();
      expect(await device.uses()).toBe(before);
    });
  });

  test('Scenario: if the passkey was deleted from the device, the PIN works, and switching off and on sets it up again', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID is on, and its passkey was then deleted (e.g. in Passwords)', async () => {
      await goto(page, '#/library');
      await switchFaceIdOn(page);
      await device.deletePasskeys();
    });
    await test.step('When I tap Settings', async () => {
      await page.getByTestId('settings-button').click();
    });
    await test.step('Then the PIN prompt stays open, and the PIN opens Settings', async () => {
      await expect(prompt(page)).toBeVisible();
      await enterPin(page, PIN);
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
    await test.step('And switching it off and on again sets up a new passkey that works', async () => {
      await toggle(page).uncheck();
      await expect(toggle(page)).not.toBeChecked();
      await toggle(page).check();
      await expect.poll(() => device.passkeys()).toBe(1);
      await expect(toggle(page)).toBeChecked();
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
    });
  });

  test('Scenario: switching it off goes back to the PIN only', async ({ page, pinSet }) => {
    const device = await faceIdDevice(page);
    await test.step('Given Face ID is on', async () => {
      await goto(page, '#/library');
      await switchFaceIdOn(page);
    });
    await test.step('When I switch it off in Settings', async () => {
      await page.getByTestId('settings-button').click();
      await expect(page.getByTestId('screen-settings')).toBeVisible();
      await toggle(page).uncheck();
      await page.getByTestId('screen-settings').getByTestId('back-button').click();
    });
    const before = await device.uses();
    await test.step('Then the PIN prompt asks for the PIN only, and Face ID is not asked', async () => {
      await page.getByTestId('settings-button').click();
      await expect(prompt(page)).toBeVisible();
      await expect(faceIdButton(page)).toBeHidden();
      expect(await device.uses()).toBe(before);
    });
  });

  test('Scenario: a device without Face ID or Touch ID does not offer it', async ({ page, pinSet }) => {
    await test.step('Given a device without Face ID or Touch ID, and Settings is unlocked', async () => {
      await goto(page, '#/library');
      await openSettings(page);
    });
    await test.step('Then Settings has no "Face ID / Touch ID" switch', async () => {
      await expect(toggle(page)).toHaveCount(0);
    });
  });

  test('Scenario: if the device refuses to start playback after Face ID, Play shows again', async ({ page, pinSet, seedLibrary }) => {
    await faceIdDevice(page);
    await test.step('Given Face ID is on, "tiny" is open, and the device will refuse the next start of playback', async () => {
      await goto(page, '#/library');
      await seedLibrary('tiny');
      await switchFaceIdOn(page);
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
    await test.step('Then the video is paused, with the play button showing, like after the PIN', async () => {
      await expect(playerState(page)).toHaveAttribute('data-state', 'paused');
      await expect(page.getByTestId('play-button')).toBeVisible();
      await expectNotPlaying(page);
    });
    await test.step('And tapping play and passing Face ID again plays it', async () => {
      await page.getByTestId('play-button').tap();
      await expectPlaying(page);
    });
  });
});
