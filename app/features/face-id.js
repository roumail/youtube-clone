// Feature "faceId": Face ID / Touch ID answers the PIN prompt. Switching it on
// sets up a passkey for this app on this device (setUp); with it on, every PIN
// prompt that asks for the current PIN starts Face ID as it opens, and passing
// it counts as the right PIN. While Face ID is asked, the prompt stays out of
// sight, so only the device's own sheets show. A prompt opened without a tap
// (play from the device's media controls) waits for a tap on "Use Face ID"
// instead. A failed or cancelled Face ID shows the prompt for the PIN, and
// "Use Face ID" tries again. Switching it off forgets the passkey's id.
// With no PIN (Face ID alone), the prompt has no PIN field, and "Set up Face
// ID again" replaces a lost passkey.
const KEY = 'faceId.credentialId';

const challenge = () => crypto.getRandomValues(new Uint8Array(32));
const toBase64Url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Set up a passkey on this device. Throws if Face ID fails or is cancelled. */
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

export function init(ctx) {
  const { $, prompt, answerPrompt, faceIdAsking } = ctx;
  const button = $('pin-faceid-button');
  const again = $('pin-faceid-setup-button');
  const listening = new AbortController();

  const ask = () => navigator.credentials.get({ publicKey: {
    challenge: challenge(),
    allowCredentials: [{ type: 'public-key', id: fromBase64Url(localStorage.getItem(KEY)) }],
    userVerification: 'required',
    timeout: 60_000,
  } });

  // Face ID (or setting it up again, which needs Face ID or the device
  // passcode too): passing it answers the prompt.
  const attempt = (faceId) => async () => {
    faceIdAsking(true);
    try {
      await faceId();
    } catch (e) {
      // Failed or cancelled: the prompt shows again. Logged so a console
      // (Web Inspector on the iPad) shows why.
      console.warn('Face ID:', e.name, e.message);
      faceIdAsking(false);
      return;
    }
    answerPrompt();
  };
  button.addEventListener('click', attempt(ask), { signal: listening.signal });
  again.addEventListener('click', attempt(setUp), { signal: listening.signal });

  return {
    // Shown while a prompt asks for the current PIN (or, with no PIN, for
    // Face ID alone); not during a lockout. With no PIN, a lost passkey can be
    // set up again.
    render() {
      const p = prompt();
      button.hidden = !['verify', 'faceid'].includes(p?.mode);
      button.disabled = p?.status === 'locked-out';
      again.hidden = p?.mode !== 'faceid';
    },
    // A prompt just opened: after a tap, start Face ID at once (a disabled
    // button ignores this); otherwise wait for a tap on "Use Face ID".
    promptOpened(byTap) {
      if (byTap) button.click();
    },
    stop() {
      listening.abort();
      button.hidden = true;
      again.hidden = true;
      localStorage.removeItem(KEY);
    },
  };
}
