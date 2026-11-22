// App: routing + one state object + render(state).
// M2 library/import, M3 player + PIN gate, M4 first-run PIN, lockout, change
// PIN, offline (service worker) and installability.
import { installLocalScheme, pickedSource, CONTAINER_EXT } from './local-scheme.js';
import {
  initDrive, pickFromDrive, signedIn, signIn, signInEnds, driveSource, listFolder, FOLDER,
} from './drive.js';
import {
  hasPin, verifyPinSync, savePin, removePin, isValidNewPin, lockoutRemaining, recordFailure, recordSuccess,
} from './pin.js';
import {
  listVideos, importVideo, addStreamed, streamUri, removeVideo, parseTitle,
} from './library.js';
import { hideStreamed } from './streamed.js';
import {
  playerState, initPlayer, openVideo, closeVideo, requestPlay, cancelPlay, allowPlay, pause,
  timeUp, seekTo, seekBy, playOn,
} from './player.js';
import {
  FEATURES, flags, setFlag, loadEnabled, start as startFeature, unavailable as unavailableFeatures, setUp as setUpFeature,
} from './features.js';

const $ = (testid, root = document) => root.querySelector(`[data-testid="${testid}"]`);

const state = {
  route: { name: 'library' },
  pinSet: false,
  library: [], // the catalogue: stored and streamed videos (library.js listVideos)
  settingsUnlocked: false,
  search: '', // library search text (not saved); typing needs the PIN
  searchUnlocked: false, // until the search field loses focus
  // PIN prompt: { purpose: 'setup' | 'import' | 'drive' | 'download' | 'settings' | 'play' | 'change' | 'search'
  //                       | 'remove-pin' | 'faceid-off',
  //              mode: 'start' | 'setup' | 'confirm' | 'verify' | 'change' | 'continue', status: 'entry' | 'wrong' | 'faceid', error }
  //              ('start': first run offers Face ID or a PIN; 'faceid': Face ID is being asked, the prompt out of sight;
  //               mode 'continue': Face ID passed, an action that needs a tap waits for "Continue")
  // A 'verify' prompt with no PIN set (Face ID alone) shows as mode 'faceid': no PIN field.
  prompt: null,
  newPin: null, // first entry of a new PIN, until it is confirmed
  returnTo: '#/library', // where the player's Back goes (the library or a series list)
  features: {}, // running optional features, by id (features.js)
  unavailable: new Set(), // optional features this device can't offer
  jobs: [], // adds and downloads, one row each: { phase: 'storing' | 'done' | 'error' | 'cancelled', progress, message, cancel }
  signingIn: null, // a Google sign-in started by the tap that opened a streamed video
  downloadTarget: null, // the streamed video whose Download asked for the PIN
  downloading: new Set(), // the streamed videos being downloaded (their URIs)
  // Videos ticked to play in a row (catalogue ids, in the order ticked); null
  // while not selecting. Not saved.
  selection: null,
  // The playlist playing: { ids, index, advancing }; null for a video played alone.
  playlist: null,
};

function parseRoute(hash) {
  const [, name = 'library', arg] = /^#\/([^/]*)\/?(.*)$/.exec(hash) ?? [];
  if (name === 'player') return { name, videoId: decodeURIComponent(arg) };
  if (name === 'settings') return { name };
  if (name === 'series') return { name, series: decodeURIComponent(arg) };
  return { name: 'library' };
}

const go = (hash) => { location.hash = hash; };

// ---------- render ----------

const PROMPT_TITLES = {
  start: 'Unlock with Face ID or a PIN?', setup: 'Set a PIN (4–6 digits)', confirm: 'Enter the PIN again',
  verify: 'Enter PIN', faceid: 'Unlock with Face ID', change: 'New PIN (4–6 digits)',
  continue: 'Face ID passed',
};

// Actions the browser only allows during a tap: the file picker, and Google's
// sign-in window when a sign-in is due (Google's file picker opens inside the
// page). Face ID takes a moment, and Safari no longer counts the tap that
// asked for it, so after Face ID these wait for a tap on "Continue".
const needsTap = (purpose) => purpose === 'import' || (['drive', 'download'].includes(purpose) && !signedIn());

// Unlocking is set up: a PIN, or Face ID alone. Until then, first run.
const unlockSetUp = (s) => s.pinSet || !!s.features.faceId;

function pinPromptFor(s) {
  if (!s.prompt) return null;
  const mode = s.prompt.mode === 'verify' && !s.pinSet ? 'faceid' : s.prompt.mode;
  const locked = mode === 'verify' && lockoutRemaining() > 0;
  return {
    mode,
    status: locked ? 'locked-out' : s.prompt.status,
    title: PROMPT_TITLES[mode],
    error: locked ? 'Too many wrong tries. Wait a minute.' : s.prompt.error,
    cancellable: s.prompt.purpose !== 'setup',
  };
}

function tile(testid, poster, ...texts) {
  const li = document.createElement('li');
  li.dataset.testid = testid;
  li.tabIndex = 0;
  const img = document.createElement('img');
  img.src = poster;
  img.alt = '';
  li.append(img);
  for (const [i, text] of texts.entries()) {
    const span = document.createElement('span');
    span.textContent = text;
    if (i > 0) span.className = 'tile-note';
    li.append(span);
  }
  return li;
}

// Opening a video remembers where Back should return to. A streamed video
// renews the Google sign-in on this tap if needed, so it is ready by play.
function openFrom(c, from) {
  state.returnTo = from;
  state.signingIn = streamsNow(c) ? signInIfNeeded() : null;
  state.signingIn?.catch(() => {}); // a failed sign-in is shown by the player
  go(`#/player/${encodeURIComponent(c.offlineUri)}`);
}

function videoTile(c) {
  const li = tile('library-item', c.appMetadata.poster, c.appMetadata.title);
  li.dataset.videoId = c.offlineUri;
  li.dataset.playsFrom = c.playsFrom;
  downloadControls(li, c);
  selectable(li, c, '#/library');
  return li;
}

// ---------- selecting (a playlist) ----------

// A tap opens a video; holding it starts selecting and ticks it. While
// selecting, a tap ticks or unticks. Lifting the finger after a hold may still
// send a click, which is not a tap.
const HOLD_MS = 500;
let holdTimer = null;
let held = false;
const clearHold = () => { clearTimeout(holdTimer); holdTimer = null; };

function selectable(li, c, from) {
  const id = c.offlineUri;
  if (state.selection) {
    const place = state.selection.indexOf(id);
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', String(place >= 0));
    if (place >= 0) {
      const number = document.createElement('span');
      number.dataset.testid = 'selection-number';
      number.textContent = String(place + 1);
      li.append(number);
    }
  }
  // A hold only starts selecting; while selecting, any press is a tap.
  li.addEventListener('pointerdown', () => {
    held = false;
    clearHold();
    if (state.selection) return;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      held = true;
      state.selection = [id];
      update();
    }, HOLD_MS);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) li.addEventListener(type, clearHold);
  li.addEventListener('contextmenu', (event) => event.preventDefault());
  li.addEventListener('click', () => {
    if (held) {
      held = false;
      return;
    }
    if (state.selection) toggleSelected(id);
    else openFrom(c, from);
  });
}

// Unticking the last ticked video stops selecting.
function toggleSelected(id) {
  const rest = state.selection.filter((x) => x !== id);
  if (rest.length === state.selection.length) rest.push(id);
  state.selection = rest.length ? rest : null;
  update();
}

function playSelection() {
  const ids = state.selection;
  state.selection = null;
  state.playlist = { ids, index: 0, advancing: false };
  openFrom(state.library.find((c) => c.offlineUri === ids[0]), '#/library');
}

// At the end of a video in a playlist, the next one opens and plays by itself:
// the PIN was given at the start. The last one stops, as any video does.
// Replacing the history entry keeps Back (and the back gesture) going to the library.
function onEnded() {
  const list = state.playlist;
  if (!list || list.index === list.ids.length - 1) return;
  list.index += 1;
  list.advancing = true;
  location.replace(`#/player/${encodeURIComponent(list.ids[list.index])}`);
}

// A streamed video's tile says whether it is downloaded, and offers Download
// (behind the PIN) while it isn't. Stored videos are already on the device.
function downloadControls(li, c) {
  if (c.playsFrom !== 'drive') return;
  li.dataset.downloaded = c.download ? 'true' : (state.downloading.has(c.offlineUri) ? 'downloading' : 'false');
  if (li.dataset.downloaded !== 'false') return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'download-button';
  button.textContent = 'Download';
  button.addEventListener('click', (event) => {
    event.stopPropagation(); // not opening the video
    state.downloadTarget = c;
    askPin('download');
  });
  li.append(button);
}

function seriesTile(name, episodes) {
  const count = `${episodes.length} episode${episodes.length === 1 ? '' : 's'}`;
  const li = tile('series-item', episodes[0].appMetadata?.poster, name, count);
  li.dataset.series = name;
  li.addEventListener('click', () => go(`#/series/${encodeURIComponent(name)}`));
  return li;
}


function episodeTile(c, hash) {
  const p = parseTitle(c.appMetadata?.title);
  const label = `S${pad2(p.season)}E${pad2(p.episode)}${p.episodeTitle ? ` · ${p.episodeTitle}` : ''}`;
  const li = tile('episode-item', c.appMetadata?.poster, label);
  li.dataset.videoId = c.offlineUri;
  li.dataset.playsFrom = c.playsFrom;
  downloadControls(li, c);
  selectable(li, c, hash);
  return li;
}

// The library: one tile per series, next to standalone videos.
// The list is already in library order, so a series' first episode marks its place.
function libraryTiles(library) {
  const bySeries = new Map();
  for (const c of library) {
    const { series } = parseTitle(c.appMetadata?.title);
    if (series) bySeries.set(series, [...(bySeries.get(series) ?? []), c]);
  }
  const tiles = [];
  for (const c of library) {
    const { series } = parseTitle(c.appMetadata?.title);
    if (!series) tiles.push(videoTile(c));
    else if (bySeries.get(series)[0] === c) tiles.push(seriesTile(series, bySeries.get(series)));
  }
  return tiles;
}

function settingsRow(c) {
  const li = document.createElement('li');
  li.dataset.testid = 'settings-video-item';
  const title = document.createElement('span');
  title.textContent = c.appMetadata.title;
  // A stored video's copy can be removed; a streamed one has none, so it can
  // only be hidden from this device (it stays in Google Drive). A streamed
  // video's download can be removed on its own.
  const streamed = c.playsFrom === 'drive';
  const button = (testid, text, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = testid;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };
  li.append(title);
  if (c.download) li.append(button('remove-download-button', 'Remove download', () => onRemove(c.download)));
  li.append(streamed
    ? button('hide-video-button', 'Hide', () => onHide(c))
    : button('remove-video-button', 'Remove', () => onRemove(c.offlineUri)));
  return li;
}

function render(s) {
  const show = (testid, visible) => { $(testid).hidden = !visible; };

  // Library
  show('screen-library', s.route.name === 'library');
  $('screen-library').dataset.state = s.library.length ? 'ready' : 'empty';
  const query = s.search.trim().toLowerCase();
  const shown = query
    ? s.library.filter((c) => c.appMetadata.title.toLowerCase().includes(query))
    : s.library;
  // While searching, matching episodes are listed one by one.
  document.querySelector('[data-role="library-grid"]').replaceChildren(
    ...(query ? shown.map(videoTile) : libraryTiles(s.library)),
  );
  renderSearchField(s);
  show('search-clear', s.search !== '');
  show('search-empty', query !== '' && shown.length === 0);

  renderJobs(s.jobs);

  // Selecting: the bar, on the library and series screens
  if (s.selection) $('screen-library').dataset.mode = 'select';
  else delete $('screen-library').dataset.mode;
  show('selection-bar', !!s.selection && ['library', 'series'].includes(s.route.name));
  if (s.selection) {
    $('selection-count').textContent = `${s.selection.length} selected`;
    $('selection-play').textContent = `Play ${s.selection.length}`;
  }

  // Series: its episodes, in season/episode order
  show('screen-series', s.route.name === 'series');
  if (s.route.name === 'series') {
    const hash = `#/series/${encodeURIComponent(s.route.series)}`;
    document.querySelector('[data-role="series-title"]').textContent = s.route.series;
    document.querySelector('[data-role="episode-grid"]').replaceChildren(
      ...s.library.filter((c) => parseTitle(c.appMetadata?.title).series === s.route.series)
        .map((c) => episodeTile(c, hash)),
    );
  }

  // Player
  show('screen-player', s.route.name === 'player');
  if (s.route.name === 'player') {
    const status = playerState.status;
    $('screen-player').dataset.state = status;
    $('player-error').textContent = playerState.error || "This video isn't in the library.";
    renderControlsVisibility();
    watchSignIn();
    show('play-button', ['paused', 'ended', 'pin-required', 'time-up'].includes(status));
    show('pause-button', status === 'playing');
  }

  // Settings
  show('screen-settings', s.route.name === 'settings');
  $('change-pin-button').textContent = s.pinSet ? 'Change PIN' : 'Set a PIN';
  show('remove-pin-button', s.pinSet && !!s.features.faceId);
  $('screen-settings').dataset.state = s.settingsUnlocked ? 'unlocked' : 'locked';
  document.querySelector('[data-role="settings-list"]').replaceChildren(
    ...(s.settingsUnlocked ? s.library.map(settingsRow) : []),
  );
  document.querySelector('[data-role="feature-settings"]').replaceChildren(
    ...(s.settingsUnlocked ? featureSettings(s) : []),
  );
  for (const f of Object.values(s.features)) f.render?.();

  // PIN prompt (overlay over any screen)
  const prompt = pinPromptFor(s);
  show('pin-prompt', !!prompt && prompt.status !== 'faceid');
  if (prompt) {
    $('pin-prompt').dataset.mode = prompt.mode;
    $('pin-prompt').dataset.state = prompt.status;
    $('pin-prompt').querySelector('[data-role="pin-title"]').textContent = prompt.title;
    show('pin-cancel', prompt.cancellable);
    const typed = !['start', 'faceid', 'continue'].includes(prompt.mode);
    show('pin-input', typed);
    show('pin-submit', typed);
    show('pin-continue-button', prompt.mode === 'continue');
    show('setup-faceid-button', prompt.mode === 'start');
    show('setup-pin-button', prompt.mode === 'start');
    show('pin-error', !!prompt.error);
    $('pin-error').textContent = prompt.error;
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

// byTap: the prompt opens from a tap on the page (not from the device's
// media controls); features may start something only a tap allows.
function askPin(purpose, byTap = true) {
  state.prompt = { purpose, mode: 'verify', status: 'entry', error: '' };
  $('pin-input').value = '';
  update();
  for (const f of Object.values(state.features)) f.promptOpened?.(byTap);
  // Face ID may have started: then the PIN field waits until it fails.
  if (state.prompt.status !== 'faceid') $('pin-input').focus();
}

async function onPinSubmit(event) {
  event.preventDefault();
  const prompt = state.prompt;
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
    // Switching Face ID off, with no PIN before: now that there is one.
    if (prompt.purpose === 'faceid-off') return onFeatureToggle('faceId', false);
    return update();
  }

  // Checking the current PIN. Synchronous on purpose: the file picker and
  // playback below must start within the user's tap, or Safari (iPad) refuses.
  if (lockoutRemaining() > 0) return update();
  const ok = verifyPinSync(value);
  if (!ok) {
    if (recordFailure()) scheduleLockoutEnd();
    Object.assign(prompt, { status: 'wrong', error: 'Wrong PIN.' });
    return update();
  }
  recordSuccess();
  return acceptPrompt(prompt);
}

// The prompt was answered: by the right PIN, or by an optional feature (Face ID).
async function acceptPrompt(prompt) {
  const { purpose } = prompt;
  if (purpose === 'change') {
    Object.assign(prompt, { mode: 'change', status: 'entry', error: '' });
    return update();
  }
  state.prompt = null;
  if (purpose === 'import') {
    // Still within the tap on "OK", so the browser allows opening the picker.
    $('import-input').click();
  } else if (purpose === 'download') {
    // Within the tap too: the download may need a new Google sign-in.
    downloadVideo(state.downloadTarget, signInIfNeeded());
  } else if (purpose === 'drive') {
    // Also within the tap: Google's sign-in opens a pop-up.
    pickFromDrive(addFromDrive);
  } else if (purpose === 'settings') {
    state.settingsUnlocked = true;
  } else if (purpose === 'remove-pin') {
    removePin();
    state.pinSet = false;
  } else if (purpose === 'search') {
    // Focus within the tap on "OK", so the iPad/iPhone keyboard comes up.
    state.searchUnlocked = true;
    update();
    $('search-input').focus();
    return;
  } else {
    update();
    // Optional features may step in first (e.g. ask for a watch-time budget);
    // they call proceed() from their own tap, so playback still starts in-gesture.
    const proceed = () => { allowPlay(signInForPlay()).then(update); update(); };
    const cancel = () => { cancelPlay(); update(); };
    if (Object.values(state.features).some((f) => f.beforePlay?.(proceed, cancel))) return update();
    await allowPlay(signInForPlay()); // still within the tap, so autoplay rules allow it
  }
  update();
}

// Settings rows for optional features: one toggle each, plus a running
// feature's own rows (e.g. "End watch-time session").
function featureSettings(s) {
  const on = flags();
  const rows = [];
  for (const f of FEATURES.filter((x) => !s.unavailable.has(x.id))) {
    const label = document.createElement('label');
    label.className = 'feature-toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.testid = `feature-toggle-${f.id}`;
    box.checked = !!on[f.id];
    box.addEventListener('change', () => onFeatureToggle(f.id, box.checked));
    label.append(box, ` ${f.title}`);
    rows.push(label);
    rows.push(...(s.features[f.id]?.settingsRows?.() ?? []));
  }
  return rows;
}

async function onFeatureToggle(id, on) {
  // Face ID alone: switching it off needs a PIN to unlock with first.
  if (id === 'faceId' && !on && !state.pinSet) {
    state.prompt = { purpose: 'faceid-off', mode: 'change', status: 'entry', error: '' };
    update();
    $('pin-input').focus();
    return;
  }
  if (on) {
    try {
      await setUpFeature(id);
    } catch {
      return update(); // its setup failed or was cancelled: it stays off
    }
  }
  setFlag(id, on);
  if (on && !state.features[id]) state.features[id] = await startFeature(id, featureContext());
  if (!on && state.features[id]) { state.features[id].stop(); delete state.features[id]; }
  update();
}

// First run: "Set up Face ID". If it fails or is cancelled, both choices stay.
async function onSetUpFaceId() {
  await onFeatureToggle('faceId', true);
  if (state.features.faceId) state.prompt = null;
  update();
}

function onUsePinInstead() {
  Object.assign(state.prompt, { mode: 'setup', status: 'entry', error: '' });
  update();
  $('pin-input').focus();
}

function featureContext() {
  return {
    $, playerState, timeUp, changed: () => update(),
    prompt: () => pinPromptFor(state),
    // Face ID started (the prompt goes out of sight) or failed (the prompt
    // shows again, ready for the PIN).
    faceIdAsking: (asking) => {
      Object.assign(state.prompt, { status: asking ? 'faceid' : 'entry', error: '' });
      update();
      $('pin-input').focus();
    },
    answerPrompt: () => {
      recordSuccess();
      if (needsTap(state.prompt.purpose)) {
        Object.assign(state.prompt, { mode: 'continue', status: 'entry', error: '' });
        return update();
      }
      return acceptPrompt(state.prompt);
    },
  };
}

// ---------- seek (M8) ----------
const pad2 = (n) => String(n).padStart(2, '0');
function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return s >= 3600 ? `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}` : `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
let dragging = false;
function showPosition() {
  const v = $('player-video');
  const bar = $('seek-bar');
  const total = Number.isFinite(v.duration) ? v.duration : 0;
  bar.max = String(Math.floor(total));
  if (!dragging) bar.value = String(Math.floor(v.currentTime));
  $('time-elapsed').textContent = clock(dragging ? Number(bar.value) : v.currentTime);
  $('time-total').textContent = clock(total);
}
// Phones: the on-screen keyboard covers part of the screen, and Safari doesn't
// shrink full-screen layers for it. Keep the PIN prompt inside the area that is
// still visible, so the field and buttons stay above the keyboard.
function initVisibleArea() {
  const vv = window.visualViewport;
  const root = document.documentElement.style;
  const apply = () => {
    root.setProperty('--visible-top', `${vv.offsetTop}px`);
    root.setProperty('--visible-height', `${vv.height}px`);
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}
// Library search: locked until the PIN, unlocked until
// the field loses focus; clearing needs no PIN.
// The search field alone: locking it on blur must not rebuild the results,
// or a tap on a result would land on a tile that was just replaced.
function renderSearchField(s) {
  const search = $('search-input');
  search.dataset.state = s.searchUnlocked ? 'unlocked' : 'locked';
  search.readOnly = !s.searchUnlocked;
  if (search.value !== s.search) search.value = s.search;
}

function initSearch() {
  const input = $('search-input');
  input.addEventListener('click', () => { if (!state.searchUnlocked) askPin('search'); });
  input.addEventListener('input', () => {
    state.search = input.value;
    update();
  });
  input.addEventListener('blur', () => {
    if (!state.searchUnlocked) return;
    state.searchUnlocked = false;
    renderSearchField(state);
  });
  $('search-clear').addEventListener('click', () => {
    state.search = '';
    update();
  });
}

// Controls hide while playing: after 3 s without input,
// Back / Pause / scrub bar fade out; any mouse movement, tap or key shows them
// again. Never while paused or while a prompt is open. The watch-time clock is
// not part of the controls and always stays.
const HIDE_CONTROLS_AFTER_MS = 3000;
let controlsHidden = false;
let hideTimer = null;
const controlsMayHide = () => state.route.name === 'player' && playerState.status === 'playing'
  && !state.prompt && $('budget-prompt').hidden;
function armHideTimer() {
  if (hideTimer || controlsHidden) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    controlsHidden = true;
    update();
  }, HIDE_CONTROLS_AFTER_MS);
}
function renderControlsVisibility() {
  if (!controlsMayHide()) {
    controlsHidden = false;
    clearTimeout(hideTimer);
    hideTimer = null;
  } else {
    armHideTimer();
  }
  $('screen-player').dataset.controls = controlsHidden ? 'hidden' : 'shown';
}
function showControls() {
  if (state.route.name !== 'player') return;
  clearTimeout(hideTimer);
  hideTimer = null;
  if (controlsHidden) {
    controlsHidden = false;
    update();
  } else if (controlsMayHide()) {
    armHideTimer();
  }
}
function initControlsHide() {
  const screen = $('screen-player');
  for (const type of ['pointermove', 'pointerdown', 'touchstart']) {
    screen.addEventListener(type, showControls, { passive: true });
  }
  document.addEventListener('keydown', showControls);
}
function initSeek() {
  const v = $('player-video');
  const bar = $('seek-bar');
  for (const ev of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked', 'emptied']) v.addEventListener(ev, showPosition);
  bar.addEventListener('pointerdown', () => { dragging = true; });
  // WebKit (iPad, iPhone) sends no change event when a finger taps the bar.
  for (const ev of ['pointerup', 'pointercancel']) bar.addEventListener(ev, () => { dragging = false; showPosition(); });
  bar.addEventListener('input', () => { seekTo(Number(bar.value)); showPosition(); });
  bar.addEventListener('change', () => { dragging = false; seekTo(Number(bar.value)); showPosition(); update(); });
  document.addEventListener('keydown', (e) => {
    if (state.route.name !== 'player' || state.prompt || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.target instanceof HTMLInputElement && e.target !== bar) return; // typing a PIN
    e.preventDefault(); // also stops the range input's own 1-second step
    seekBy(e.key === 'ArrowRight' ? 10 : -10);
    showPosition();
    update();
  });
}

// ---------- streamed videos ----------

// A streamed video that isn't downloaded plays from Google Drive.
const streamsNow = (c) => c.playsFrom === 'drive' && !c.download;
const playing = () => state.library.find((c) => c.offlineUri === playerState.offlineUri);
// Call within a tap: the sign-in in progress, or null if still signed in.
const signInIfNeeded = () => (signedIn() ? null : signIn());

// Within the play PIN's tap: a streamed video needs a valid Google sign-in.
// Returns the sign-in in progress, or null when none is needed.
function signInForPlay() {
  return streamsNow(playing()) ? signInIfNeeded() : null;
}

// A streamed video pauses just before the sign-in ends; play with the PIN
// signs in again (renewing it needs a tap).
let signInTimer = null;
function watchSignIn() {
  if (playerState.status !== 'playing' || !streamsNow(playing())) {
    clearTimeout(signInTimer);
    signInTimer = null;
  } else if (!signInTimer) {
    signInTimer = setTimeout(() => { signInTimer = null; onPause(); }, signInEnds() - Date.now());
  }
}

// What the player loads for a streamed video: its parts, read from Google
// Drive, once the sign-in started by the opening tap (if any) is done.
async function streamFrom(entry, signing) {
  try {
    await signing;
    return await streamUri(driveSource(entry.file));
  } catch (e) {
    throw Object.assign(e, {
      userMessage: e.offline ? `"${entry.appMetadata.title}" streams from Google Drive and needs the internet.` : e.message,
    });
  }
}

// Adds and downloads: a row each, kept (not rebuilt) while it runs, so its
// Cancel stays under the finger. A finished row clears itself after a while;
// one that failed stays longer, so it can be read.
const CLEAR_AFTER_MS = { done: 10_000, cancelled: 10_000, error: 60_000 };
const jobRows = new Map(); // job -> { li, text, bar, cancel }

function renderJobs(jobs) {
  for (const [job, row] of jobRows) {
    if (!jobs.includes(job)) {
      row.li.remove();
      jobRows.delete(job);
    }
  }
  for (const job of jobs) {
    let row = jobRows.get(job);
    if (!row) {
      const li = document.createElement('li');
      li.dataset.testid = 'import-status';
      li.setAttribute('role', 'status');
      const text = document.createElement('span');
      const bar = document.createElement('progress');
      bar.dataset.testid = 'import-progress';
      bar.max = 1;
      li.append(text, bar);
      document.querySelector('[data-role="jobs"]').append(li);
      row = { li, text, bar, cancel: null };
      jobRows.set(job, row);
    }
    row.li.dataset.import = job.phase;
    row.text.textContent = job.message;
    row.bar.hidden = job.phase !== 'storing';
    row.bar.value = job.progress;
    if (job.cancel && !row.cancel) {
      row.cancel = document.createElement('button');
      row.cancel.type = 'button';
      row.cancel.dataset.testid = 'cancel-download-button';
      row.cancel.textContent = 'Cancel';
      const { cancel } = job;
      row.cancel.addEventListener('click', () => cancel.abort());
      row.li.append(row.cancel);
    } else if (!job.cancel && row.cancel) {
      row.cancel.remove();
      row.cancel = null;
    }
  }
}

function startJob(message, cancel = null) {
  const job = { phase: 'storing', progress: 0, message, cancel };
  state.jobs.push(job);
  update();
  return job;
}

function endJob(job, phase, message) {
  Object.assign(job, { phase, message, cancel: null });
  setTimeout(() => {
    state.jobs = state.jobs.filter((j) => j !== job);
    update();
  }, CLEAR_AFTER_MS[phase]);
  update();
}

const onJobProgress = (job) => (p) => {
  job.progress = p;
  update();
};

// Several files picked at once: added one after another; a bad file doesn't
// stop the rest, and the summary names what failed.
async function importSeveral(items, sourceOf, add) {
  const total = items.length;
  let added = 0;
  const failed = [];
  const job = startJob(`Adding ${total} videos…`);
  for (const [i, item] of items.entries()) {
    if (!item.name.toLowerCase().endsWith(CONTAINER_EXT)) {
      failed.push(`${item.name} (not a ${CONTAINER_EXT} file)`);
      continue;
    }
    const name = item.name.slice(0, -CONTAINER_EXT.length);
    Object.assign(job, { progress: 0, message: `Adding ${i + 1} of ${total}: ${name}…` });
    update();
    try {
      await add(sourceOf(item), onJobProgress(job));
      added += 1;
    } catch (e) {
      failed.push(`${name} (${e.message})`);
    }
    await refreshLibrary();
    update();
  }
  const summary = `Added ${added} of ${total} videos.`;
  if (failed.length) endJob(job, 'error', `${summary} Couldn't add: ${failed.join('; ')}.`);
  else endJob(job, 'done', summary);
}

// Play (button or OS command): the PIN comes first, every time.
function onPlayRequested(byTap) {
  if (state.route.name !== 'player' || state.prompt) return;
  if (requestPlay()) askPin('play', byTap);
}

function onPause() {
  pause();
  if (state.prompt?.purpose === 'play') state.prompt = null;
  update();
}

function onPinCancel() {
  const purpose = state.prompt?.purpose;
  state.prompt = null;
  state.newPin = null;
  if (purpose === 'settings') go('#/library');
  if (purpose === 'play') cancelPlay();
  update();
}

// Picked in Google Drive: files are added as streamed; a picked folder adds
// every .kidsvideo in it and its subfolders, skipping titles already there.
async function addFromDrive(docs, sourceOf) {
  const folders = docs.filter((d) => d.mimeType === FOLDER);
  if (!folders.length) return importItems(docs, sourceOf, addStreamed);
  const items = docs.filter((d) => d.mimeType !== FOLDER);
  const job = startJob(`Looking in "${folders[0].name}"…`);
  for (const folder of folders) {
    job.message = `Looking in "${folder.name}"…`;
    update();
    try {
      items.push(...await listFolder(folder));
    } catch (e) {
      return endJob(job, 'error', `Couldn't add the folder "${folder.name}": ${e.message}`);
    }
  }
  if (!items.length) return endJob(job, 'error', `There are no .kidsvideo files in "${folders[0].name}".`);
  const from = docs.length === 1 ? ` from "${folders[0].name}"` : '';
  let added = 0;
  let skipped = 0;
  const failed = [];
  for (const [i, item] of items.entries()) {
    const name = item.name.slice(0, -CONTAINER_EXT.length);
    Object.assign(job, { progress: i / items.length, message: `Adding ${i + 1} of ${items.length}: ${name}…` });
    update();
    try {
      await addStreamed(sourceOf(item));
      added += 1;
    } catch (e) {
      if (e.duplicate) skipped += 1;
      else failed.push(`${name} (${e.message})`);
    }
    await refreshLibrary();
  }
  const summary = `Added ${added} of ${items.length} videos${from}${skipped ? ` (${skipped} already in the library)` : ''}.`;
  if (failed.length) endJob(job, 'error', `${summary} Couldn't add: ${failed.join('; ')}.`);
  else endJob(job, 'done', summary);
}

// Picked files (stored: importVideo) or files in Google Drive (streamed:
// addStreamed); sourceOf(item) gives its byte source.
async function importItems(items, sourceOf, add) {
  if (items.length > 1) return importSeveral(items, sourceOf, add);
  const job = startJob('Adding video…');
  try {
    const stored = await add(sourceOf(items[0]), onJobProgress(job));
    endJob(job, 'done', `Added "${stored.appMetadata.title}".`);
  } catch (e) {
    endJob(job, 'error', `Couldn't add the video: ${e.message}`);
  }
  await refreshLibrary();
  update();
}

async function onRemove(offlineUri) {
  await removeVideo(offlineUri);
  await refreshLibrary();
  update();
}

// Hiding a streamed video also removes its download, so nothing is left.
async function onHide(c) {
  await hideStreamed(c.offlineUri);
  if (c.download) await removeVideo(c.download);
  await refreshLibrary();
  update();
}

// Download a streamed video: a stored copy for offline viewing, kept with it.
// Cancel stops it at its next read of Google Drive; nothing of it is kept.
async function downloadVideo(entry, signing) {
  const { title } = entry.appMetadata;
  const cancel = new AbortController();
  state.downloading.add(entry.offlineUri);
  const job = startJob(`Downloading "${title}"…`, cancel);
  const source = driveSource(entry.file);
  const read = source.read;
  source.read = (start, end) => {
    cancel.signal.throwIfAborted();
    return read(start, end);
  };
  try {
    await signing;
    await importVideo(source, onJobProgress(job), entry.offlineUri);
    endJob(job, 'done', `Downloaded "${title}".`);
  } catch (e) {
    if (cancel.signal.aborted) endJob(job, 'cancelled', `Download of "${title}" cancelled.`);
    else endJob(job, 'error', `Couldn't download "${title}": ${e.message}`);
  }
  state.downloading.delete(entry.offlineUri);
  await refreshLibrary();
  update();
}

function onRouteChange() {
  const previous = state.route;
  state.route = parseRoute(location.hash);
  if (previous.name === 'player') {
    if (state.prompt?.purpose === 'play') state.prompt = null;
    closeVideo().then(update);
  }
  // Leaving the player ends a playlist.
  if (state.route.name !== 'player') state.playlist = null;
  const advancing = state.playlist?.advancing;
  if (advancing) state.playlist.advancing = false;
  if (state.route.name === 'player') {
    const id = state.route.videoId;
    const entry = state.library.find((c) => c.offlineUri === id);
    // A streamed video loads now if signed in (or signing in, from the tap that
    // opened it); otherwise at play, after signing in.
    const signing = state.signingIn;
    state.signingIn = null;
    // A downloaded one opens its stored copy.
    let opening;
    if (entry && streamsNow(entry)) opening = openVideo(id, true, () => streamFrom(entry, signing), !signing && !signedIn());
    else if (entry?.download) opening = openVideo(id, true, async () => entry.download);
    else opening = openVideo(id, Boolean(entry));
    opening.then(async () => {
      if (advancing && state.route.videoId === id) await playOn();
      update();
    });
  }
  if (previous.name === 'settings' && state.route.name !== 'settings') state.settingsUnlocked = false;
  if (state.route.name === 'settings' && !state.settingsUnlocked && unlockSetUp(state)) {
    askPin('settings');
  } else if (state.prompt?.purpose === 'settings') {
    state.prompt = null;
  }
  update();
}

// ---------- boot ----------

// The released version (written to version.json at deploy), shown next to
// "Library". Local and CI runs have no version.json: it stays "dev".
async function showVersion() {
  try {
    const res = await fetch('version.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const { version } = await res.json();
    $('app-version').textContent = version;
  } catch {
    // offline and not cached yet: keep the current text
  }
}

async function boot() {
  shaka.polyfill.installAll();
  installLocalScheme();

  $('add-video-button').addEventListener('click', () => askPin('import'));
  $('settings-button').addEventListener('click', () => go('#/settings'));
  for (const screen of ['screen-settings', 'screen-series']) {
    $('back-button', $(screen)).addEventListener('click', () => go('#/library'));
  }
  $('back-button', $('screen-player')).addEventListener('click', () => go(state.returnTo));
  $('pin-prompt').querySelector('form').addEventListener('submit', onPinSubmit);
  $('pin-cancel').addEventListener('click', onPinCancel);
  $('import-input').addEventListener('change', (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    importItems(files, pickedSource, importVideo);
  });
  $('add-from-drive-button').addEventListener('click', () => askPin('drive'));
  $('play-button').addEventListener('click', () => onPlayRequested(true));
  $('pause-button').addEventListener('click', onPause);
  $('change-pin-button').addEventListener('click', () => askPin('change'));
  $('remove-pin-button').addEventListener('click', () => askPin('remove-pin'));
  $('setup-faceid-button').addEventListener('click', onSetUpFaceId);
  $('setup-pin-button').addEventListener('click', onUsePinInstead);
  $('pin-continue-button').addEventListener('click', () => acceptPrompt(state.prompt));
  $('selection-cancel').addEventListener('click', () => { state.selection = null; update(); });
  $('selection-play').addEventListener('click', playSelection);
  initSearch();
  window.addEventListener('hashchange', onRouteChange);

  initPlayer($('player-video'), update);
  $('player-video').addEventListener('ended', onEnded);
  initSeek();
  initVisibleArea();
  initControlsHide();
  // Leaving the app (switching apps, locking the screen) pauses; coming back
  // needs the PIN again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onPause();
  });
  // OS media controls (lock screen, Control Center, headphones, media keys):
  // "play" goes through the PIN like the on-screen button; "pause" is free.
  navigator.mediaSession.setActionHandler('play', () => onPlayRequested(false));
  navigator.mediaSession.setActionHandler('pause', onPause);

  // Offline + installable: cache the app shell (network-first, sw.js).
  navigator.serviceWorker.register('sw.js');
  // One user, no UI: just ask the browser to keep the library.
  navigator.storage.persist();

  state.unavailable = await unavailableFeatures();
  state.features = await loadEnabled(featureContext());

  // First run: a device with Face ID / Touch ID offers it first, else a PIN.
  state.pinSet = hasPin();
  if (!unlockSetUp(state)) {
    const mode = state.unavailable.has('faceId') ? 'setup' : 'start';
    state.prompt = { purpose: 'setup', mode, status: 'entry', error: '' };
  }
  await refreshLibrary();
  state.route = { name: '' };
  onRouteChange();
  scheduleLockoutEnd();
  $('app').dataset.ready = 'true';
  showVersion();
  initDrive().then((ready) => { $('add-from-drive-button').hidden = !ready; });
}

boot();
