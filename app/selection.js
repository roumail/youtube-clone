// Selecting: hold a tile to start ticking videos, tap to tick more; the
// selection bar then plays them in a row (a playlist), downloads or removes
// them. A tap without selecting opens the video.
import { hideStreamed } from './streamed.js';
import { removeVideo } from './library.js';
import {
  state, $, update, go, refreshLibrary, streamsNow, onDevice, signInIfNeeded,
} from './state.js';
import { toDownload } from './downloads.js';

// Opening a video remembers where Back should return to. A streamed video
// renews the Google sign-in on this tap if needed, so it is ready by play.
function openFrom(c, from) {
  if (!state.online && streamsNow(c)) return; // dimmed: it can't play with no connection
  state.returnTo = from;
  state.signingIn = streamsNow(c) ? signInIfNeeded() : null;
  state.signingIn?.catch(() => {}); // a failed sign-in is shown by the player
  go(`#/player/${encodeURIComponent(c.offlineUri)}`);
}

// A tap opens a video; holding it starts selecting and ticks it. While
// selecting, a tap ticks or unticks. Lifting the finger after a hold may still
// send a click, which is not a tap.
const HOLD_MS = 500;
let holdTimer = null;
let held = false;
const clearHold = () => { clearTimeout(holdTimer); holdTimer = null; };

export function selectable(li, c, from) {
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

export function playSelection() {
  const ids = toPlay(state);
  state.selection = null;
  state.playlist = { ids, index: 0, advancing: false };
  openFrom(state.library.find((c) => c.offlineUri === ids[0]), '#/library');
}

// At the end of a video in a playlist, the next one opens and plays by itself:
// it was unlocked at the start. The last one stops, as any video does.
// Replacing the history entry keeps Back (and the back gesture) going to the library.
export function onEnded() {
  const list = state.playlist;
  if (!list || list.index === list.ids.length - 1) return;
  list.index += 1;
  list.advancing = true;
  location.replace(`#/player/${encodeURIComponent(list.ids[list.index])}`);
}

// Ticked videos Play would play, in the order ticked: with no connection,
// only those that play offline.
const toPlay = (s) => s.selection.filter((id) => s.online || onDevice(s.library.find((c) => c.offlineUri === id)));

// Remove (selection bar, after Face ID): a stored video's copy is deleted; a
// streamed one is hidden from this device (it stays in Google Drive and can be
// added again), its download too, so nothing of it is left.
export async function removeSelection() {
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

// The selection bar, on the library and series screens.
export function renderSelectionBar(s) {
  const show = (testid, visible) => { $(testid).hidden = !visible; };
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
}
