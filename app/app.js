// App: routing + render(state) of every screen, the unlock flow (Face ID /
// Touch ID, unlock.js), playing and streaming, and start-up. The state object
// and what all parts share are in state.js; adding (adding.js), downloads
// (downloads.js), the selection bar (selection.js) and the progress rows
// (jobs.js) have their own modules.
import { installLocalScheme, pickedSource } from './local-scheme.js';
import {
  initDrive, pickFromDrive, signedIn, signInEnds, driveSource, whenSignedIn, goneFromDrive,
} from './drive.js';
import * as unlock from './unlock.js';
import { importVideo, streamUri } from './library.js';
import { hideStreamed } from './streamed.js';
import {
  playerState, initPlayer, openVideo, closeVideo, requestPlay, cancelPlay, allowPlay, pause,
  timeUp, seekTo, seekBy, playOn,
} from './player.js';
import {
  FEATURES, flags, setFlag, loadEnabled, start as startFeature,
} from './features.js';
import {
  state, $, go, update, setRender, refreshLibrary, streamsNow, playing, signInIfNeeded, onDevice,
} from './state.js';
import { renderJobs, startJob, endJob } from './jobs.js';
import {
  importItems, addFromDrive, renderChoosing, onChooseToggle, onChooseCancel, onChooseAdd,
} from './adding.js';
import { downloadControls, downloadRow, downloadVideo, toDownload } from './downloads.js';
import {
  selectable, playSelection, onEnded, removeSelection, renderSelectionBar,
} from './selection.js';

function parseRoute(hash) {
  const [, name = 'library', arg] = /^#\/([^/]*)\/?(.*)$/.exec(hash) ?? [];
  if (name === 'player') return { name, videoId: decodeURIComponent(arg) };
  if (name === 'settings') return { name };
  if (name === 'series') return { name, series: decodeURIComponent(arg) };
  return { name: 'library' };
}

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

function videoTile(c) {
  const li = tile('library-item', c.appMetadata.poster, c.appMetadata.title);
  li.dataset.videoId = c.offlineUri;
  li.dataset.playsFrom = c.playsFrom;
  downloadControls(li, c);
  selectable(li, c, '#/library');
  return li;
}

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

  renderSelectionBar(s);

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
    $('timer-button').disabled = !['playing', 'paused', 'ended', 'time-up'].includes(status);
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

setRender(render);

// ---------- actions ----------

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
    if (Object.values(state.features).some((f) => f.beforePlay?.(proceed, cancel, prompt.newBudget))) return update();
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

// Play (button or OS command): unlocking comes first, every time.
function onPlayRequested(byTap) {
  if (state.route.name !== 'player' || state.prompt) return;
  if (requestPlay()) askUnlock('play', byTap);
}

// The clock in the session bar: a new time limit, behind Face ID. The video
// pauses meanwhile; choosing a time plays it, Cancel leaves it paused with the
// time limit it had. Only offered while the video can play (render).
function onTimerTapped() {
  pause();
  requestPlay();
  askUnlock('play');
  state.prompt.newBudget = true;
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
  $('timer-button').addEventListener('click', onTimerTapped);
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
