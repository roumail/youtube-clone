// Optional parental features behind flags. Each feature is its own module; a feature that's off is never
// loaded. Flags live in localStorage['features'] and are switched in Settings,
// which is behind the PIN. Each feature has its own default; a flag nobody has
// touched follows it.
const FLAGS_KEY = 'features';

export const FEATURES = [
  // On by default (owner decision 2026-11-19); a parent can switch it off.
  { id: 'watchTimeLimit', title: 'Watch-time limit', default: true, load: () => import('./features/watch-time.js') },
];

const defaults = () => Object.fromEntries(FEATURES.map((f) => [f.id, !!f.default]));

/** Every feature's on/off: the stored choice, else the feature's default. */
export function flags() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(FLAGS_KEY)) ?? {};
  } catch {
    // unreadable: fall back to the defaults
  }
  return { ...defaults(), ...stored };
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
