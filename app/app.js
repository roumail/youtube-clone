// App: routing + one state object + render(state) (DESIGN.md §2, §7 contract).
// M2 library/import, M3 player + PIN gate, M4 first-run PIN, lockout, change
// PIN, offline (service worker) and installability.
import { installLocalScheme } from './local-scheme.js';
import {
  hasPin, verifyPin, savePin, isValidNewPin, lockoutRemaining, recordFailure, recordSuccess,
} from './pin.js';
import { listVideos, importVideo, removeVideo } from './library.js';
import {
  playerState, initPlayer, openVideo, closeVideo, requestPlay, cancelPlay, allowPlay, pause,
} from './player.js';

const $ = (testid, root = document) => root.querySelector(`[data-testid="${testid}"]`);

const state = {
  route: { name: 'library' },
  pinSet: false,
  library: [], // usable Shaka StoredContent
  settingsUnlocked: false,
  // PIN prompt: { purpose: 'setup' | 'import' | 'settings' | 'play' | 'change',
  //              mode: 'setup' | 'confirm' | 'verify' | 'change', status: 'entry' | 'wrong', error }
  prompt: null,
  newPin: null, // first entry of a new PIN, until it is confirmed
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

const PROMPT_TITLES = { setup: 'Set a PIN (4–6 digits)', confirm: 'Enter the PIN again', verify: 'Enter PIN', change: 'New PIN (4–6 digits)' };

function pinPromptFor(s) {
  if (!s.prompt) return null;
  const locked = s.prompt.mode === 'verify' && lockoutRemaining() > 0;
  return {
    mode: s.prompt.mode,
    status: locked ? 'locked-out' : s.prompt.status,
    title: PROMPT_TITLES[s.prompt.mode],
    error: locked ? 'Too many wrong tries. Wait a minute.' : s.prompt.error,
    cancellable: s.prompt.purpose !== 'setup',
  };
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

  // Player
  show('screen-player', s.route.name === 'player');
  if (s.route.name === 'player') {
    const status = playerState.status;
    $('screen-player').dataset.state = status;
    show('play-button', ['paused', 'ended', 'pin-required'].includes(status));
    show('pause-button', status === 'playing');
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
    show('pin-cancel', prompt.cancellable);
    show('pin-error', !!prompt.error);
    $('pin-error').textContent = prompt.error ?? '';
    $('pin-submit').disabled = prompt.status === 'locked-out';
    $('pin-input').disabled = prompt.status === 'locked-out';
  }
}

const update = () => render(state);

// ---------- actions ----------

async function refreshLibrary() {
  state.library = await listVideos();
}

// Re-render when a lockout ends (also after a reload during a lockout).
function scheduleLockoutEnd() {
  const left = lockoutRemaining();
  if (left > 0) setTimeout(update, left + 10);
}

function askPin(purpose) {
  state.prompt = { purpose, mode: 'verify', status: 'entry', error: '' };
  $('pin-input').value = '';
  update();
  $('pin-input').focus();
}

async function onPinSubmit(event) {
  event.preventDefault();
  const prompt = state.prompt;
  if (!prompt) return;
  const input = $('pin-input');
  const value = input.value;
  input.value = '';

  // Choosing a new PIN (first run, or "Change PIN"), then confirming it.
  if (prompt.mode === 'setup' || prompt.mode === 'change') {
    if (!isValidNewPin(value)) {
      Object.assign(prompt, { status: 'wrong', error: 'Use 4 to 6 digits.' });
      return update();
    }
    state.newPin = value;
    Object.assign(prompt, { mode: 'confirm', status: 'entry', error: '' });
    return update();
  }
  if (prompt.mode === 'confirm') {
    if (value !== state.newPin) {
      state.newPin = null;
      Object.assign(prompt, {
        mode: prompt.purpose === 'setup' ? 'setup' : 'change', status: 'wrong', error: "The PINs didn't match. Try again.",
      });
      return update();
    }
    await savePin(value);
    state.newPin = null;
    state.pinSet = true;
    recordSuccess();
    state.prompt = null;
    return update();
  }

  // Checking the current PIN.
  if (lockoutRemaining() > 0) return update();
  const ok = await verifyPin(value);
  if (!ok) {
    if (recordFailure()) scheduleLockoutEnd();
    Object.assign(prompt, { status: 'wrong', error: 'Wrong PIN.' });
    return update();
  }
  recordSuccess();
  const { purpose } = prompt;
  if (purpose === 'change') {
    Object.assign(prompt, { mode: 'change', status: 'entry', error: '' });
    return update();
  }
  state.prompt = null;
  if (purpose === 'import') {
    // Still within the tap on "OK", so the browser allows opening the picker.
    $('import-input').click();
  } else if (purpose === 'settings') {
    state.settingsUnlocked = true;
  } else if (purpose === 'play') {
    update();
    await allowPlay(); // still within the tap, so autoplay rules allow it
  }
  update();
}

// Play (button or OS command): the PIN comes first, every time.
function onPlayRequested() {
  if (state.route.name !== 'player' || state.prompt) return;
  if (requestPlay()) askPin('play');
}

function onPause() {
  pause();
  if (state.prompt?.purpose === 'play') state.prompt = null;
  update();
}

function onPinCancel() {
  const purpose = state.prompt?.purpose;
  if (purpose === 'setup') return; // the first-run PIN can't be skipped
  state.prompt = null;
  state.newPin = null;
  if (purpose === 'settings') go('#/library');
  if (purpose === 'play') cancelPlay();
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
  const previous = state.route;
  state.route = parseRoute(location.hash);
  const leftPlayer = previous.name === 'player'
    && (state.route.name !== 'player' || state.route.videoId !== previous.videoId);
  if (leftPlayer) {
    if (state.prompt?.purpose === 'play') state.prompt = null;
    closeVideo().then(update);
  }
  if (state.route.name === 'player' && (leftPlayer || previous.name !== 'player' || playerState.offlineUri == null)) {
    const exists = state.library.some((c) => c.offlineUri === state.route.videoId);
    openVideo(state.route.videoId, exists).then(update);
  }
  if (previous.name === 'settings' && state.route.name !== 'settings') state.settingsUnlocked = false;
  if (state.route.name === 'settings' && !state.settingsUnlocked && state.pinSet) {
    state.prompt = { purpose: 'settings', mode: 'verify', status: 'entry', error: '' };
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
  $('play-button').addEventListener('click', onPlayRequested);
  $('pause-button').addEventListener('click', onPause);
  $('change-pin-button').addEventListener('click', () => askPin('change'));
  window.addEventListener('hashchange', onRouteChange);

  initPlayer($('player-video'), update);
  // Leaving the app (switching apps, locking the screen) pauses; coming back
  // needs the PIN again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onPause();
  });
  // OS media controls (lock screen, Control Center, headphones, media keys):
  // "play" goes through the PIN like the on-screen button; "pause" is free.
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', onPlayRequested);
    navigator.mediaSession.setActionHandler('pause', onPause);
  }

  // Offline + installable: cache the app shell (network-first, sw.js).
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  // One user, no UI: just ask the browser to keep the library (DESIGN.md §1).
  navigator.storage?.persist?.().catch(() => {});

  state.pinSet = hasPin();
  if (!state.pinSet) state.prompt = { purpose: 'setup', mode: 'setup', status: 'entry', error: '' };
  await refreshLibrary();
  state.route = { name: '' };
  onRouteChange();
  scheduleLockoutEnd();
  $('app').dataset.ready = 'true';
}

boot();
