// Feature "faceId": Face ID / Touch ID answers the PIN prompt. Switching it on
// sets up a passkey for this app on this device (setUp); with it on, every PIN
// prompt that asks for the current PIN starts Face ID as it opens, and passing
// it counts as the right PIN. A prompt opened without a tap (play from the
// device's media controls) waits for a tap on "Use Face ID" instead. A failed or cancelled Face ID leaves the prompt
// open for the PIN, and "Use Face ID" tries again. Switching it off forgets
// the passkey's id.
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
  const { $, prompt, answerPrompt } = ctx;
  const button = $('pin-faceid-button');
  const listening = new AbortController();

  async function ask() {
    try {
      await navigator.credentials.get({ publicKey: {
        challenge: challenge(),
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(localStorage.getItem(KEY)) }],
        userVerification: 'required',
        timeout: 60_000,
      } });
    } catch {
      return; // failed or cancelled: the prompt stays open for the PIN
    }
    answerPrompt();
  }
  button.addEventListener('click', ask, { signal: listening.signal });

  return {
    // Shown while a prompt asks for the current PIN; not during a lockout.
    render() {
      const p = prompt();
      button.hidden = p?.mode !== 'verify';
      button.disabled = p?.status === 'locked-out';
    },
    // A prompt just opened: after a tap, start Face ID at once (a disabled
    // button ignores this); otherwise wait for a tap on "Use Face ID".
    promptOpened(byTap) {
      if (byTap) button.click();
    },
    stop() {
      listening.abort();
      button.hidden = true;
      localStorage.removeItem(KEY);
    },
  };
}
