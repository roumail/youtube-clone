// Unlocking: Face ID / Touch ID, the one way a parent unlocks. First run sets
// up a passkey for this app on this device (setUp); every unlock asks the
// device for it (verify), and the device falls back to its own passcode.
// Failed tries are the device's business: the app keeps no PIN, no count and
// no lockout. Only whether first run is done is stored.
const KEY = 'faceId.setUp';
const USER = 'parent';

const challenge = () => crypto.getRandomValues(new Uint8Array(32));

/** This device has Face ID, Touch ID or a passcode the browser can use. */
export const available = async () => !!(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable());

/** First run is done: this app has a passkey on this device. */
export const isSetUp = () => !!localStorage.getItem(KEY);

/** Make the passkey (again). Throws if Face ID fails or is cancelled. */
export async function setUp() {
  await navigator.credentials.create({ publicKey: {
    challenge: challenge(),
    rp: { name: 'Kids videos' },
    // Always the same user, so the device replaces this app's passkey instead of adding one.
    user: { id: new TextEncoder().encode(USER), name: USER, displayName: 'Parent' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60_000,
  } });
  localStorage.setItem(KEY, 'true');
}

/** Face ID with the passkey. Throws if it fails, is cancelled, or the passkey is gone. */
export async function verify() {
  const { response } = await navigator.credentials.get({ publicKey: {
    challenge: challenge(),
    userVerification: 'required',
    timeout: 60_000,
  } });
  // Passkeys made by earlier versions each have a user of their own.
  if (new TextDecoder().decode(response.userHandle) !== USER) {
    throw new DOMException('A passkey from an earlier version', 'NotAllowedError');
  }
}

/** Earlier versions kept a PIN, its lockout and a passkey of their own: all are dropped. */
export async function forgetEarlierVersions() {
  const credentialId = localStorage.getItem('faceId.credentialId');
  if (credentialId) {
    try {
      await PublicKeyCredential.signalUnknownCredential({ rpId: location.hostname, credentialId });
    } catch (e) {
      console.warn('Passkey:', e.name, e.message); // devices without the Signal API keep it
    }
  }
  for (const key of ['faceId.credentialId', 'pin.sha256', 'pin.lockout']) localStorage.removeItem(key);
}
