// Optional parental features behind flags (DESIGN.md §5, "Optional parental
// features"). Each feature is its own module; a feature that's off is never
// loaded. Flags live in localStorage['features'] and are switched in Settings,
// which is behind the PIN. Every feature defaults to off.
const FLAGS_KEY = 'features';

export const FEATURES = [
  { id: 'watchTimeLimit', title: 'Watch-time limit', load: () => import('./features/watch-time.js') },
];

export function flags() {
  try {
    return JSON.parse(localStorage.getItem(FLAGS_KEY)) ?? {};
  } catch {
    return {};
  }
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
