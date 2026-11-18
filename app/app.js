// App shell (T0): routing + render(state) for the 4 screens. No behaviour yet:
// PIN entry, import and playback arrive in their milestones (DESIGN.md).
const PIN_KEY = 'pin.sha256';

const $ = (testid) => document.querySelector(`[data-testid="${testid}"]`);

const state = {
  route: { name: 'library' },
  pinSet: false,
  library: [], // Shaka StoredContent[]
  settingsUnlocked: false,
};

function parseRoute(hash) {
  const [, name = 'library', arg] = /^#\/([^/]*)\/?(.*)$/.exec(hash) ?? [];
  if (name === 'player') return { name, videoId: decodeURIComponent(arg) };
  if (name === 'settings') return { name };
  return { name: 'library' };
}

function pinPromptFor(s) {
  if (!s.pinSet) return { mode: 'setup', title: 'Set a PIN' };
  if (s.route.name === 'settings' && !s.settingsUnlocked) return { mode: 'verify', title: 'Enter PIN' };
  return null;
}

function render(s) {
  const show = (testid, visible) => { $(testid).hidden = !visible; };

  // Library
  show('screen-library', s.route.name === 'library');
  $('screen-library').dataset.state = s.library.length ? 'ready' : 'empty';

  // Player
  show('screen-player', s.route.name === 'player');
  if (s.route.name === 'player') {
    const found = s.library.some((c) => c.offlineUri === s.route.videoId);
    $('screen-player').dataset.state = found ? 'loading' : 'error';
  }

  // Settings
  show('screen-settings', s.route.name === 'settings');
  $('screen-settings').dataset.state = s.settingsUnlocked ? 'unlocked' : 'locked';

  // PIN prompt (overlay over any screen)
  const prompt = pinPromptFor(s);
  show('pin-prompt', !!prompt);
  if (prompt) {
    $('pin-prompt').dataset.mode = prompt.mode;
    $('pin-prompt').querySelector('[data-role="pin-title"]').textContent = prompt.title;
    show('pin-cancel', prompt.mode !== 'setup');
  }
}

async function loadLibrary() {
  shaka.polyfill.installAll();
  if (!shaka.offline.Storage.support()) return [];
  const storage = new shaka.offline.Storage();
  try {
    return await storage.list();
  } finally {
    await storage.destroy();
  }
}

async function boot() {
  state.pinSet = !!localStorage.getItem(PIN_KEY);
  state.route = parseRoute(location.hash);
  state.library = await loadLibrary();
  render(state);
  $('app').dataset.ready = 'true';

  window.addEventListener('hashchange', () => {
    state.route = parseRoute(location.hash);
    render(state);
  });
}

boot();
