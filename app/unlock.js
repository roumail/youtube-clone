// Unlocking: Face ID / Touch ID, the one way a parent unlocks. First run sets
// up a passkey for this app on this device (setUp); every unlock asks the
// device for it (verify), and the device falls back to its own passcode.
// Failed tries are the device's business: the app keeps no PIN, no count and
// no lockout. Only the passkey's id is stored.
const KEY = 'faceId.credentialId';

const challenge = () => crypto.getRandomValues(new Uint8Array(32));
const toBase64Url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** This device has Face ID, Touch ID or a passcode the browser can use. */
export const available = async () => !!(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable());

/** First run is done: this app has a passkey on this device. */
export const isSetUp = () => !!localStorage.getItem(KEY);

/** Make the passkey (again). Throws if Face ID fails or is cancelled. */
export async function setUp() {
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: challenge(),
    rp: { name: 'Kids videos' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'parent', displayName: 'Parent' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60_000,
  } });
  localStorage.setItem(KEY, toBase64Url(credential.rawId));
}

/** Face ID with the passkey. Throws if it fails, is cancelled, or the passkey is gone. */
export async function verify() {
  await navigator.credentials.get({ publicKey: {
    challenge: challenge(),
    allowCredentials: [{ type: 'public-key', id: fromBase64Url(localStorage.getItem(KEY)) }],
    userVerification: 'required',
    timeout: 60_000,
  } });
}

/** Installs from before kept a PIN and its lockout: both are forgotten. */
export function forgetPin() {
  localStorage.removeItem('pin.sha256');
  localStorage.removeItem('pin.lockout');
}
