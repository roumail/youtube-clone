// App: routing + one state object + render(state).
// Everything behind the parent unlocks with Face ID / Touch ID (unlock.js);
// offline (service worker) and installability.
import { installLocalScheme, pickedSource, CONTAINER_EXT } from './local-scheme.js';
import {
  initDrive, pickFromDrive, signedIn, signIn, signInEnds, driveSource, listFolder, FOLDER, whenSignedIn, goneFromDrive,
} from './drive.js';
import * as unlock from './unlock.js';
import {
  listVideos, importVideo, addStreamed, streamUri, removeVideo,
} from './library.js';
import { hideStreamed } from './streamed.js';
import {
  playerState, initPlayer, openVideo, closeVideo, requestPlay, cancelPlay, allowPlay, pause,
  timeUp, seekTo, seekBy, playOn,
} from './player.js';
import {
  FEATURES, flags, setFlag, loadEnabled, start as startFeature,
} from './features.js';

const $ = (testid, root = document) => root.querySelector(`[data-testid="${testid}"]`);

const state = {
  route: { name: 'library' },
  setUp: false, // first run is done: Face ID is set up on this device
  library: [], // the catalogue: stored and streamed videos (library.js listVideos)
  settingsUnlocked: false,
  search: '', // library search text (not saved); typing needs unlocking
  searchUnlocked: false, // until the search field loses focus
  // Unlock prompt: { purpose: 'setup' | 'import' | 'drive' | 'download' | 'settings' | 'play' | 'search',
  //                 mode: 'unavailable' | 'setup' | 'unlock' | 'continue', asking, failures }
  // ('unavailable': no Face ID, Touch ID or passcode; 'setup': first run;
  //  'unlock': Face ID failed, was cancelled, or waits for a tap; 'continue':
  //  Face ID passed, and an action that needs a tap waits for "Continue").
  // While asking, Face ID is being asked and the prompt is out of sight.
  prompt: null,
  returnTo: '#/library', // where the player's Back goes (the library or a series list)
  features: {}, // running optional features, by id (features.js)
  jobs: [], // adds and downloads, one row each: { phase: 'storing' | 'done' | 'error' | 'cancelled', progress, message, cancel }
  signingIn: null, // a Google sign-in started by the tap that opened a streamed video
  online: navigator.onLine, // with no connection, streamed videos can't play
  downloadedOnly: false, // the library's "Downloaded" filter (not saved)
  downloading: new Set(), // the streamed videos being downloaded (their URIs)
  // Videos ticked to play in a row (catalogue ids, in the order ticked); null
  // while not selecting. Not saved.
  selection: null,
  // The playlist playing: { ids, index, advancing }; null for a video played alone.
  playlist: null,
  // A picked folder's videos, to choose from: { title, from, sourceOf,
  // items: [{ doc, name, inLibrary, ticked }] }; null when not choosing.
  choosing: null,
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
  unavailable: "This device can't use Kids Library", setup: 'Set up Face ID / Touch ID',
  unlock: 'Unlock with Face ID', continue: 'Face ID passed',
};

// Actions the browser only allows during a tap: the file picker, and Google's
// sign-in window when a sign-in is due (adding from Drive, downloading, or
// playing a streamed video; Google's file picker opens inside the page).
// Face ID takes a moment, and Safari no longer counts the tap that asked for
// it, so after Face ID these wait for a tap on "Continue".
const needsTap = (purpose) => purpose === 'import'
  || (!signedIn() && (['drive', 'download'].includes(purpose) || (purpose === 'play' && streamsNow(playing()))));

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
  if (!state.online && streamsNow(c)) return; // dimmed: it can't play with no connection
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
  const ids = toPlay(state);
  state.selection = null;
  state.playlist = { ids, index: 0, advancing: false };
  openFrom(state.library.find((c) => c.offlineUri === ids[0]), '#/library');
}

// At the end of a video in a playlist, the next one opens and plays by itself:
// it was unlocked at the start. The last one stops, as any video does.
// Replacing the history entry keeps Back (and the back gesture) going to the library.
function onEnded() {
  const list = state.playlist;
  if (!list || list.index === list.ids.length - 1) return;
  list.index += 1;
  list.advancing = true;
  location.replace(`#/player/${encodeURIComponent(list.ids[list.index])}`);
}

// A streamed video's tile says whether it is downloaded (a "Downloaded"
// badge), and is dimmed with no connection unless it is. Stored videos are
// always on the device. Downloading is from the selection bar.
function downloadControls(li, c) {
  if (c.playsFrom !== 'drive') return;
  li.dataset.downloaded = c.download ? 'true' : (state.downloading.has(c.offlineUri) ? 'downloading' : 'false');
  if (!state.online && streamsNow(c)) li.dataset.unavailable = 'true';
  if (!c.download) return;
  const badge = document.createElement('span');
  badge.dataset.testid = 'downloaded-badge';
  badge.textContent = 'Downloaded';
  li.append(badge);
}

// Plays with no connection: stored, or streamed and downloaded.
const onDevice = (c) => !streamsNow(c);
// Ticked videos Play would play, in the order ticked: with no connection,
// only those that play offline.
const toPlay = (s) => s.selection.filter((id) => s.online || onDevice(s.library.find((c) => c.offlineUri === id)));
// Ticked videos that Download would download: streamed, not downloaded or
// downloading. None with no connection (it would only fail).
const toDownload = (s) => (s.online ? s.library.filter((c) => s.selection.includes(c.offlineUri)
  && c.playsFrom === 'drive' && !c.download && !s.downloading.has(c.offlineUri)) : []);

// "3 episodes" when every video in it is numbered, else "3 videos".
function seriesTile(name, episodes) {
  const noun = episodes.every((c) => c.group.season !== undefined) ? 'episode' : 'video';
  const downloaded = episodes.filter((c) => c.download).length;
  const count = `${episodes.length} ${noun}${episodes.length === 1 ? '' : 's'}${downloaded ? ` · ${downloaded} downloaded` : ''}`;
  const li = tile('series-item', episodes[0].appMetadata?.poster, name, count);
  li.dataset.series = name;
  if (!state.online && !episodes.some(onDevice)) li.dataset.unavailable = 'true';
  li.addEventListener('click', () => go(`#/series/${encodeURIComponent(name)}`));
  return li;
}


function episodeTile(c, hash) {
  const g = c.group;
  const label = g.season === undefined
    ? g.title
    : `S${pad2(g.season)}E${pad2(g.episode)}${g.title ? ` · ${g.title}` : ''}`;
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
    const series = c.group?.name;
    if (series) bySeries.set(series, [...(bySeries.get(series) ?? []), c]);
  }
  const tiles = [];
  for (const c of library) {
    const series = c.group?.name;
    if (!series) tiles.push(videoTile(c));
    else if (bySeries.get(series)[0] === c) tiles.push(seriesTile(series, bySeries.get(series)));
  }
  return tiles;
}

// Settings lists the downloads: removing one frees the space, and the video
// streams again. (Videos leave the library from the selection bar: Remove.)
function downloadRow(c) {
  const li = document.createElement('li');
  li.dataset.testid = 'settings-download-item';
  const title = document.createElement('span');
  title.textContent = c.appMetadata.title;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'remove-download-button';
  button.textContent = 'Remove download';
  button.addEventListener('click', () => onRemoveDownload(c.download));
  li.append(title, button);
  return li;
}

function render(s) {
  const show = (testid, visible) => { $(testid).hidden = !visible; };

  // Library
  show('screen-library', s.route.name === 'library');
  $('screen-library').dataset.state = s.library.length ? 'ready' : 'empty';
  const query = s.search.trim().toLowerCase();
  // The "Downloaded" filter keeps what plays with no connection.
  const visible = s.downloadedOnly ? s.library.filter(onDevice) : s.library;
  const shown = query
    ? visible.filter((c) => c.appMetadata.title.toLowerCase().includes(query))
    : visible;
  // While searching, matching episodes are listed one by one.
  document.querySelector('[data-role="library-grid"]').replaceChildren(
    ...(query ? shown.map(videoTile) : libraryTiles(visible)),
  );
  renderSearchField(s);
  show('search-clear', s.search !== '');
  show('search-empty', query !== '' && shown.length === 0);
  $('library-filter').setAttribute('aria-pressed', String(s.downloadedOnly));
  show('filter-empty', s.downloadedOnly && query === '' && visible.length === 0);

  renderJobs(s.jobs);
  renderChoosing(s);

  // Selecting: the bar, on the library and series screens
  if (s.selection) $('screen-library').dataset.mode = 'select';
  else delete $('screen-library').dataset.mode;
  show('selection-bar', !!s.selection && ['library', 'series'].includes(s.route.name));
  if (s.selection) {
    $('selection-count').textContent = `${s.selection.length} selected`;
    const plays = toPlay(s).length;
    show('selection-play', plays > 0);
    $('selection-play').textContent = `Play ${plays}`;
    $('selection-remove').textContent = `Remove ${s.selection.length}`;
    const downloads = toDownload(s).length;
    show('selection-download', downloads > 0);
    $('selection-download').textContent = `Download ${downloads}`;
  }

  // Series: its episodes, in season/episode order
  show('screen-series', s.route.name === 'series');
  if (s.route.name === 'series') {
    const hash = `#/series/${encodeURIComponent(s.route.series)}`;
    document.querySelector('[data-role="series-title"]').textContent = s.route.series;
    document.querySelector('[data-role="episode-grid"]').replaceChildren(
      ...visible.filter((c) => c.group?.name === s.route.series)
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
  $('screen-settings').dataset.state = s.settingsUnlocked ? 'unlocked' : 'locked';
  const downloads = s.settingsUnlocked ? s.library.filter((c) => c.download) : [];
  show('downloads-heading', downloads.length > 0);
  document.querySelector('[data-role="settings-list"]').replaceChildren(...downloads.map(downloadRow));
  document.querySelector('[data-role="feature-settings"]').replaceChildren(
    ...(s.settingsUnlocked ? featureSettings(s) : []),
  );
  for (const f of Object.values(s.features)) f.render?.();

  // Unlock prompt (overlay over any screen); out of sight while Face ID is asked
  const p = s.prompt;
  show('unlock-prompt', !!p && !p.asking);
  if (p) {
    $('unlock-prompt').dataset.mode = p.mode;
    $('unlock-prompt').querySelector('[data-role="unlock-title"]').textContent = PROMPT_TITLES[p.mode];
    show('unlock-unavailable', p.mode === 'unavailable');
    show('setup-faceid-parents', p.mode === 'setup');
    show('setup-faceid-button', p.mode === 'setup');
    show('unlock-faceid-button', p.mode === 'unlock');
    // A single failure is usually a face not recognised, which setting up
    // again doesn't fix; a gone passkey fails every time.
    show('unlock-faceid-setup-button', p.mode === 'unlock' && p.failures >= 2);
    show('unlock-continue-button', p.mode === 'continue');
    show('unlock-cancel', !['unavailable', 'setup'].includes(p.mode));
  }
}

const update = () => render(state);

// ---------- actions ----------

async function refreshLibrary() {
  state.library = await listVideos();
}

// Something behind the parent: Face ID first. byTap: asked from a tap on the
// page; from the device's media controls (no tap) Face ID can't start, so the
// prompt waits for a tap on "Use Face ID".
function askUnlock(purpose, byTap = true) {
  if (state.prompt?.asking) return;
  state.prompt = { purpose, mode: 'unlock', asking: false, failures: 0 };
  if (byTap) tryFaceId(unlock.verify);
  else update();
}

// Face ID (or setting it up again, which needs Face ID or the device passcode
// too). Started within the tap; the prompt is out of sight meanwhile. Passing
// it unlocks; failing it or cancelling shows the prompt again.
async function tryFaceId(faceId) {
  const prompt = state.prompt;
  Object.assign(prompt, { mode: 'unlock', asking: true });
  update();
  try {
    await faceId();
  } catch (e) {
    console.warn('Face ID:', e.name, e.message); // shows why in Web Inspector
    Object.assign(prompt, { asking: false, failures: prompt.failures + 1 });
    return update();
  }
  if (needsTap(prompt.purpose)) {
    Object.assign(prompt, { mode: 'continue', asking: false });
    return update();
  }
  return acceptPrompt(prompt);
}

// First run: set up Face ID, with the prompt out of sight meanwhile. If it
// fails or is cancelled, it asks again.
async function onSetUp() {
  state.prompt.asking = true;
  update();
  try {
    await unlock.setUp();
  } catch (e) {
    console.warn('Face ID:', e.name, e.message);
    state.prompt.asking = false;
    return update();
  }
  state.setUp = true;
  state.prompt = null;
  update();
}

// Unlocked: by Face ID, or by "Continue" after it.
async function acceptPrompt(prompt) {
  const { purpose } = prompt;
  state.prompt = null;
  if (purpose === 'import') {
    // Within the tap on "Continue", so the browser allows opening the picker.
    $('import-input').click();
  } else if (purpose === 'download') {
    // Within a tap too when a Google sign-in is due (needsTap). One sign-in for all.
    const signing = signInIfNeeded();
    for (const c of toDownload(state)) downloadVideo(c, signing);
    state.selection = null;
  } else if (purpose === 'drive') {
    // Likewise: Google's sign-in opens a pop-up.
    pickFromDrive(addFromDrive);
  } else if (purpose === 'settings') {
    state.settingsUnlocked = true;
  } else if (purpose === 'remove') {
    await removeSelection();
  } else if (purpose === 'search') {
    // Unlocked until the field loses focus (a tap on it brings the keyboard).
    state.searchUnlocked = true;
    update();
    $('search-input').focus();
    return;
  } else {
    update();
    // Optional features may step in first (e.g. ask for a watch-time budget);
    // they call proceed() from their own tap.
    const proceed = () => { allowPlay(signInForPlay()).then(update); update(); };
    const cancel = () => { cancelPlay(); update(); };
    if (Object.values(state.features).some((f) => f.beforePlay?.(proceed, cancel))) return update();
    await allowPlay(signInForPlay()); // a refusal shows Play again (player.js)
  }
  update();
}

// Settings rows for optional features: one toggle each, plus a running
// feature's own rows (e.g. "End watch-time session").
function featureSettings(s) {
  const on = flags();
  const rows = [];
  for (const f of FEATURES) {
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
  setFlag(id, on);
  if (on && !state.features[id]) state.features[id] = await startFeature(id, featureContext());
  if (!on && state.features[id]) { state.features[id].stop(); delete state.features[id]; }
  update();
}

function featureContext() {
  return { $, playerState, timeUp, changed: () => update() };
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
// shrink full-screen layers for it. Keep prompts inside the area that is
// still visible, so fields and buttons stay above the keyboard.
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
// Library search: locked until unlocked (Face ID), then until
// the field loses focus; clearing needs nothing.
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
  input.addEventListener('click', () => { if (!state.searchUnlocked) askUnlock('search'); });
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
    if (e.target instanceof HTMLInputElement && e.target !== bar) return; // typing (the budget's minutes)
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

// Within the tap that plays (or its "Continue"): a streamed video needs a valid Google sign-in.
// Returns the sign-in in progress, or null when none is needed.
function signInForPlay() {
  return streamsNow(playing()) ? signInIfNeeded() : null;
}

// A streamed video pauses just before the sign-in ends; play (Face ID, then
// "Continue") signs in again (renewing it needs a tap).
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
    // The sign-in's check may have found this video gone (and closed it).
    if (!state.library.some((c) => c.offlineUri === entry.offlineUri)) throw new Error('gone from Google Drive');
    return await streamUri(driveSource(entry.file));
  } catch (e) {
    if (e.notFound) await hideGoneFromDrive();
    throw Object.assign(e, {
      userMessage: e.offline ? `"${entry.appMetadata.title}" streams from Google Drive and needs the internet.` : e.message,
    });
  }
}

// After each Google sign-in, and when Drive can't find a streamed video:
// streamed videos whose file is gone from Google Drive (deleted, or in its
// trash) are hidden, as Hide does. A downloaded one stays: it plays without
// Drive. If the open video is one of them, the player closes and the library
// says why, instead of an error.
async function hideGoneFromDrive() {
  const streamed = state.library.filter(streamsNow);
  const gone = await goneFromDrive(streamed.map((c) => c.file.id));
  const hidden = streamed.filter((c) => gone.has(c.file.id));
  for (const c of hidden) await hideStreamed(c.offlineUri);
  await refreshLibrary();
  const open = hidden.find((c) => state.route.name === 'player' && c.offlineUri === state.route.videoId);
  if (open) {
    closeVideo();
    location.replace(state.returnTo);
    const message = `"${open.appMetadata.title}" is no longer in Google Drive.`;
    endJob(startJob(message), 'done', message);
  }
  update();
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

// Play (button or OS command): unlocking comes first, every time.
function onPlayRequested(byTap) {
  if (state.route.name !== 'player' || state.prompt) return;
  if (requestPlay()) askUnlock('play', byTap);
}

function onPause() {
  pause();
  if (state.prompt?.purpose === 'play') state.prompt = null;
  update();
}

function onUnlockCancel() {
  const purpose = state.prompt?.purpose;
  state.prompt = null;
  if (purpose === 'settings') go('#/library');
  if (purpose === 'play') cancelPlay();
  update();
}

// Picked in Google Drive: files alone are added as streamed. With a folder,
// every .kidsvideo in it and its subfolders (and any files picked with it) is
// listed to choose from: new ones ticked, titles already there greyed out.
async function addFromDrive(docs, sourceOf) {
  const folders = docs.filter((d) => d.mimeType === FOLDER);
  if (!folders.length) return importItems(docs, sourceOf, addStreamed);
  const found = docs.filter((d) => d.mimeType !== FOLDER);
  const job = startJob(`Looking in "${folders[0].name}"…`);
  for (const folder of folders) {
    job.message = `Looking in "${folder.name}"…`;
    update();
    try {
      found.push(...await listFolder(folder));
    } catch (e) {
      return endJob(job, 'error', `Couldn't add the folder "${folder.name}": ${e.message}`);
    }
  }
  if (!found.length) return endJob(job, 'error', `There are no .kidsvideo files in "${folders[0].name}".`);
  state.jobs = state.jobs.filter((j) => j !== job); // the list takes over
  const titles = new Set(state.library.map((c) => c.appMetadata.title));
  const items = found.map((doc) => {
    const name = doc.name.slice(0, -CONTAINER_EXT.length);
    return { doc, name, inLibrary: titles.has(name), ticked: !titles.has(name) };
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const one = docs.length === 1;
  state.choosing = {
    title: one ? `Add from "${folders[0].name}"` : 'Add from Google Drive',
    from: one ? ` from "${folders[0].name}"` : '',
    sourceOf,
    items,
  };
  update();
}

// The list of a folder's videos: tick, untick, then add the ticked ones.
function renderChoosing(s) {
  $('drive-choose').hidden = !s.choosing;
  if (!s.choosing) return;
  const { title, items } = s.choosing;
  const fresh = items.filter((i) => !i.inLibrary);
  const ticked = fresh.filter((i) => i.ticked).length;
  $('drive-choose').querySelector('[data-role="choose-title"]').textContent = title;
  $('drive-choose').querySelector('[data-role="choose-list"]').replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    li.dataset.testid = 'drive-choose-item';
    li.dataset.state = item.inLibrary ? 'in-library' : 'new';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.testid = 'drive-choose-box';
    box.checked = item.ticked;
    box.disabled = item.inLibrary;
    box.addEventListener('change', () => { item.ticked = box.checked; update(); });
    const name = document.createElement('span');
    name.textContent = item.inLibrary ? `${item.name} · in the library` : item.name;
    label.append(box, name);
    li.append(label);
    return li;
  }));
  $('drive-choose-toggle').textContent = ticked === fresh.length ? 'Untick all' : 'Tick all';
  $('drive-choose-add').textContent = `Add ${ticked}`;
  $('drive-choose-add').disabled = ticked === 0;
}

function onChooseToggle() {
  const fresh = state.choosing.items.filter((i) => !i.inLibrary);
  const tick = !fresh.every((i) => i.ticked);
  for (const item of fresh) item.ticked = tick;
  update();
}

function onChooseCancel() {
  state.choosing = null;
  update();
}

// Add the ticked videos, one after another, in one row.
async function onChooseAdd() {
  const { items, sourceOf, from } = state.choosing;
  state.choosing = null;
  const chosen = items.filter((i) => i.ticked);
  const skipped = items.filter((i) => i.inLibrary).length;
  let added = 0;
  const failed = [];
  const job = startJob('Adding…');
  for (const [i, { doc, name }] of chosen.entries()) {
    Object.assign(job, { progress: i / chosen.length, message: `Adding ${i + 1} of ${chosen.length}: ${name}…` });
    update();
    try {
      await addStreamed(sourceOf(doc));
      added += 1;
    } catch (e) {
      failed.push(`${name} (${e.message})`); // also a title already there under another file name
    }
    await refreshLibrary();
  }
  const summary = `Added ${added} of ${chosen.length} videos${from}${skipped ? ` (${skipped} already in the library)` : ''}.`;
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

async function onRemoveDownload(offlineUri) {
  await removeVideo(offlineUri);
  await refreshLibrary();
  update();
}

// Remove (selection bar, after Face ID): a stored video's copy is deleted; a
// streamed one is hidden from this device (it stays in Google Drive and can be
// added again), its download too, so nothing of it is left.
async function removeSelection() {
  const ids = state.selection;
  state.selection = null;
  for (const c of state.library.filter((v) => ids.includes(v.offlineUri))) {
    if (c.playsFrom === 'drive') {
      await hideStreamed(c.offlineUri);
      if (c.download) await removeVideo(c.download);
    } else {
      await removeVideo(c.offlineUri);
    }
  }
  await refreshLibrary();
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
  if (state.route.name === 'settings' && !state.settingsUnlocked && state.setUp) {
    askUnlock('settings');
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

  $('add-video-button').addEventListener('click', () => askUnlock('import'));
  $('settings-button').addEventListener('click', () => go('#/settings'));
  for (const screen of ['screen-settings', 'screen-series']) {
    $('back-button', $(screen)).addEventListener('click', () => go('#/library'));
  }
  $('back-button', $('screen-player')).addEventListener('click', () => go(state.returnTo));
  $('unlock-cancel').addEventListener('click', onUnlockCancel);
  $('setup-faceid-button').addEventListener('click', onSetUp);
  $('unlock-faceid-button').addEventListener('click', () => tryFaceId(unlock.verify));
  $('unlock-faceid-setup-button').addEventListener('click', () => tryFaceId(unlock.setUp));
  $('unlock-continue-button').addEventListener('click', () => acceptPrompt(state.prompt));
  $('import-input').addEventListener('change', (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    importItems(files, pickedSource, importVideo);
  });
  $('add-from-drive-button').addEventListener('click', () => askUnlock('drive'));
  $('play-button').addEventListener('click', () => onPlayRequested(true));
  $('pause-button').addEventListener('click', onPause);
  $('drive-choose-toggle').addEventListener('click', onChooseToggle);
  $('drive-choose-cancel').addEventListener('click', onChooseCancel);
  $('drive-choose-add').addEventListener('click', onChooseAdd);
  $('selection-cancel').addEventListener('click', () => { state.selection = null; update(); });
  $('selection-play').addEventListener('click', playSelection);
  $('selection-remove').addEventListener('click', () => askUnlock('remove'));
  $('selection-download').addEventListener('click', () => askUnlock('download'));
  $('library-filter').addEventListener('click', () => { state.downloadedOnly = !state.downloadedOnly; update(); });
  for (const event of ['online', 'offline']) {
    window.addEventListener(event, () => { state.online = navigator.onLine; update(); });
  }
  initSearch();
  window.addEventListener('hashchange', onRouteChange);

  initPlayer($('player-video'), update);
  $('player-video').addEventListener('ended', onEnded);
  initSeek();
  initVisibleArea();
  initControlsHide();
  // Leaving the app (switching apps, locking the screen) pauses; coming back
  // needs unlocking again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onPause();
  });
  // OS media controls (lock screen, Control Center, headphones, media keys):
  // "play" needs unlocking like the on-screen button; "pause" is free.
  navigator.mediaSession.setActionHandler('play', () => onPlayRequested(false));
  navigator.mediaSession.setActionHandler('pause', onPause);

  // Offline + installable: cache the app shell (network-first, sw.js).
  navigator.serviceWorker.register('sw.js');
  // One user, no UI: just ask the browser to keep the library.
  navigator.storage.persist();

  state.features = await loadEnabled(featureContext());

  // First run, and installs from before (their PIN and passkey are dropped): set up Face ID.
  await unlock.forgetEarlierVersions();
  state.setUp = unlock.isSetUp();
  if (!state.setUp) state.prompt = { purpose: 'setup', mode: await unlock.available() ? 'setup' : 'unavailable', asking: false };
  await refreshLibrary();
  state.route = { name: '' };
  onRouteChange();
  $('app').dataset.ready = 'true';
  showVersion();
  initDrive().then((ready) => { $('add-from-drive-button').hidden = !ready; });
  whenSignedIn(hideGoneFromDrive);
}

boot();
