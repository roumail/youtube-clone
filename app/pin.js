// PIN storage, checking and lockout (DESIGN.md §5). Only a SHA-256 hash is stored.
export const PIN_KEY = 'pin.sha256';
export const LOCKOUT_KEY = 'pin.lockout'; // { failures, until } — until is epoch ms
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hasPin = () => !!localStorage.getItem(PIN_KEY);
export const isValidNewPin = (pin) => /^\d{4,6}$/.test(pin);

export async function savePin(pin) {
  localStorage.setItem(PIN_KEY, await sha256Hex(pin));
}

export async function verifyPin(pin) {
  const stored = localStorage.getItem(PIN_KEY);
  return !!stored && (await sha256Hex(pin)) === stored;
}

function readLockout() {
  try {
    return { failures: 0, until: 0, ...JSON.parse(localStorage.getItem(LOCKOUT_KEY) ?? '{}') };
  } catch {
    return { failures: 0, until: 0 };
  }
}
const writeLockout = (l) => localStorage.setItem(LOCKOUT_KEY, JSON.stringify(l));

/** Milliseconds left in the current lockout (0 = not locked). Survives reloads. */
export const lockoutRemaining = () => Math.max(0, readLockout().until - Date.now());

/** A wrong PIN. Returns true if this locked the prompt (5th failure in a row). */
export function recordFailure() {
  const l = readLockout();
  l.failures += 1;
  if (l.failures >= MAX_FAILURES) {
    l.failures = 0;
    l.until = Date.now() + LOCKOUT_MS;
  }
  writeLockout(l);
  return l.until > Date.now();
}

export const recordSuccess = () => writeLockout({ failures: 0, until: 0 });
