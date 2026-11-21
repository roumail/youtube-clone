// Optional parental features behind flags. Each feature is its own module; a feature that's off is never
// loaded. Flags live in localStorage['features'] and are switched in Settings,
// which is behind the PIN. Each feature has its own default; a flag nobody has
// touched follows it.
const FLAGS_KEY = 'features';

export const FEATURES = [
  // On by default (owner decision 2026-11-19); a parent can switch it off.
  { id: 'watchTimeLimit', title: 'Watch-time limit', default: true, load: () => import('./features/watch-time.js') },
  // Off by default; switching it on sets up Face ID / Touch ID on this device.
  {
    id: 'faceId',
    title: 'Face ID / Touch ID',
    default: false,
    available: async () => !!(await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable()),
    load: () => import('./features/face-id.js'),
  },
];

/** Features this device can't offer (their switch isn't shown). */
export async function unavailable() {
  const out = new Set();
  for (const f of FEATURES) {
    if (!(await f.available?.() ?? true)) out.add(f.id);
  }
  return out;
}

/** Before a feature is switched on: its own setup, if it has one. Throws if that fails. */
export async function setUp(id) {
  await (await FEATURES.find((f) => f.id === id).load()).setUp?.();
}

const defaults = () => Object.fromEntries(FEATURES.map((f) => [f.id, !!f.default]));

/** Every feature's on/off: the stored choice, else the feature's default. */
export function flags() {
  return { ...defaults(), ...JSON.parse(localStorage.getItem(FLAGS_KEY)) };
}

export function setFlag(id, on) {
  localStorage.setItem(FLAGS_KEY, JSON.stringify({ ...flags(), [id]: !!on }));
}

/** Load and start every enabled feature. Returns { [id]: instance }. */
export async function loadEnabled(ctx) {
  const on = flags();
  const active = {};
  for (const f of FEATURES) {
    if (on[f.id]) active[f.id] = (await f.load()).init(ctx);
  }
  return active;
}

export async function start(id, ctx) {
  const f = FEATURES.find((x) => x.id === id);
  return (await f.load()).init(ctx);
}
