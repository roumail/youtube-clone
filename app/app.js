// App: routing + one state object + render(state) (DESIGN.md §2, §7 contract).
// Built so far: M2 (library, import, remove, PIN verify). Player behaviour (M3)
// and first-run PIN setup / lockout / offline (M4) come later.
import { installLocalScheme } from './local-scheme.js';
import { hasPin, verifyPin } from './pin.js';
import { listVideos, importVideo, removeVideo } from './library.js';

const $ = (testid, root = document) => root.querySelector(`[data-testid="${testid}"]`);

const state = {
  route: { name: 'library' },
  pinSet: false,
  library: [], // usable Shaka StoredContent
  settingsUnlocked: false,
  // PIN prompt opened for an action: { purpose: 'import' | 'settings', status: 'entry' | 'wrong' }
  prompt: null,
  importStatus: { phase: 'idle', progress: 0, message: '' },
};

function parseRoute(hash) {
  const [, name = 'library', arg] = /^#\/([^/]*)\/?(.*)$/.exec(hash) ?? [];
  if (name === 'player') return { name, videoId: decodeURIComponent(arg) };
  if (name === 'settings') return { name };
  return { name: 'library' };
}

const go = (hash) => { location.hash = hash; };

// ---------- render ----------

function pinPromptFor(s) {
  if (!s.pinSet) return { mode: 'setup', status: 'entry', title: 'Set a PIN' };
  if (s.prompt) return { mode: 'verify', status: s.prompt.status, title: 'Enter PIN' };
  return null;
}

function videoTile(c) {
  const li = document.createElement('li');
  li.dataset.testid = 'library-item';
  li.dataset.videoId = c.offlineUri;
  li.tabIndex = 0;
  const img = document.createElement('img');
  img.src = c.appMetadata?.poster ?? '';
  img.alt = '';
  const title = document.createElement('span');
  title.textContent = c.appMetadata?.title ?? 'Untitled';
  li.append(img, title);
  li.addEventListener('click', () => go(`#/player/${encodeURIComponent(c.offlineUri)}`));
  return li;
}

function settingsRow(c) {
  const li = document.createElement('li');
  li.dataset.testid = 'settings-video-item';
  const title = document.createElement('span');
  title.textContent = c.appMetadata?.title ?? 'Untitled';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.testid = 'remove-video-button';
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => onRemove(c.offlineUri));
  li.append(title, remove);
  return li;
}

function render(s) {
  const show = (testid, visible) => { $(testid).hidden = !visible; };

  // Library
  show('screen-library', s.route.name === 'library');
  $('screen-library').dataset.state = s.library.length ? 'ready' : 'empty';
  document.querySelector('[data-role="library-grid"]').replaceChildren(...s.library.map(videoTile));

  // Import status
  const st = $('import-status');
  st.dataset.import = s.importStatus.phase;
  st.textContent = s.importStatus.message;
  const bar = $('import-progress');
  bar.hidden = s.importStatus.phase !== 'storing';
  bar.value = s.importStatus.progress;

  // Player (behaviour is M3; the screen and route exist)
  show('screen-player', s.route.name === 'player');
  if (s.route.name === 'player') {
    const found = s.library.some((c) => c.offlineUri === s.route.videoId);
    $('screen-player').dataset.state = found ? 'loading' : 'error';
  }

  // Settings
  show('screen-settings', s.route.name === 'settings');
  $('screen-settings').dataset.state = s.settingsUnlocked ? 'unlocked' : 'locked';
  document.querySelector('[data-role="settings-list"]').replaceChildren(
    ...(s.settingsUnlocked ? s.library.map(settingsRow) : []),
  );

  // PIN prompt (overlay over any screen)
  const prompt = pinPromptFor(s);
  show('pin-prompt', !!prompt);
  if (prompt) {
    $('pin-prompt').dataset.mode = prompt.mode;
    $('pin-prompt').dataset.state = prompt.status;
    $('pin-prompt').querySelector('[data-role="pin-title"]').textContent = prompt.title;
    show('pin-cancel', prompt.mode !== 'setup');
    show('pin-error', prompt.status === 'wrong');
    $('pin-error').textContent = prompt.status === 'wrong' ? 'Wrong PIN' : '';
  }
}

const update = () => render(state);

// ---------- actions ----------

async function refreshLibrary() {
  state.library = await listVideos();
}

function askPin(purpose) {
  state.prompt = { purpose, status: 'entry' };
  $('pin-input').value = '';
  update();
  $('pin-input').focus();
}

async function onPinSubmit(event) {
  event.preventDefault();
  if (!state.pinSet || !state.prompt) return; // first-run setup is M4
  const input = $('pin-input');
  const ok = await verifyPin(input.value);
  input.value = '';
  if (!ok) {
    state.prompt.status = 'wrong';
    return update();
  }
  const { purpose } = state.prompt;
  state.prompt = null;
  if (purpose === 'import') {
    // Still within the tap on "OK", so the browser allows opening the picker.
    $('import-input').click();
  } else if (purpose === 'settings') {
    state.settingsUnlocked = true;
  }
  update();
}

function onPinCancel() {
  const purpose = state.prompt?.purpose;
  state.prompt = null;
  if (purpose === 'settings') go('#/library');
  update();
}

async function onFilesPicked(event) {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  state.importStatus = { phase: 'storing', progress: 0, message: 'Adding video…' };
  update();
  try {
    const stored = await importVideo(files, (p) => {
      state.importStatus.progress = p;
      update();
    });
    state.importStatus = { phase: 'done', progress: 1, message: `Added "${stored.appMetadata.title}".` };
  } catch (e) {
    state.importStatus = { phase: 'error', progress: 0, message: `Couldn't add the video: ${e.message ?? e}` };
  }
  await refreshLibrary();
  update();
}

async function onRemove(offlineUri) {
  await removeVideo(offlineUri);
  await refreshLibrary();
  update();
}

function onRouteChange() {
  const previous = state.route.name;
  state.route = parseRoute(location.hash);
  if (previous === 'settings' && state.route.name !== 'settings') state.settingsUnlocked = false;
  if (state.route.name === 'settings' && !state.settingsUnlocked && state.pinSet) {
    state.prompt = { purpose: 'settings', status: 'entry' };
  } else if (state.prompt?.purpose === 'settings') {
    state.prompt = null;
  }
  update();
}

// ---------- boot ----------

async function boot() {
  shaka.polyfill.installAll();
  installLocalScheme();

  $('add-video-button').addEventListener('click', () => askPin('import'));
  $('settings-button').addEventListener('click', () => go('#/settings'));
  for (const back of document.querySelectorAll('[data-testid="back-button"]')) {
    back.addEventListener('click', () => go('#/library'));
  }
  $('pin-prompt').querySelector('form').addEventListener('submit', onPinSubmit);
  $('pin-cancel').addEventListener('click', onPinCancel);
  $('import-input').addEventListener('change', onFilesPicked);
  window.addEventListener('hashchange', onRouteChange);

  state.pinSet = hasPin();
  await refreshLibrary();
  onRouteChange();
  $('app').dataset.ready = 'true';
}

boot();
