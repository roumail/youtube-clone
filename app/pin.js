// PIN storage and checking (DESIGN.md §5). Only a SHA-256 hash is stored.
export const PIN_KEY = 'pin.sha256';

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hasPin = () => !!localStorage.getItem(PIN_KEY);

export async function verifyPin(pin) {
  const stored = localStorage.getItem(PIN_KEY);
  return !!stored && (await sha256Hex(pin)) === stored;
}
