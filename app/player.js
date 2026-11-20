// The player: Shaka on our own <video>, custom controls only.
// Pause is free; playback only ever starts through allowPlay() (after the PIN).
// Anything else that starts playback (script, OS media keys, browser quirks)
// is paused immediately.

let player;
let video;
let authorized = false; // true only between allowPlay() and the next pause/end
let onChange;
let closing = Promise.resolve(); // a pending closeVideo(); opening waits for it
let loadLater = null; // a streamed video opened before signing in: loads at play

/**
 * status: 'loading' | 'paused' | 'pin-required' | 'playing' | 'ended' | 'time-up' | 'error';
 * error: what went wrong, when it's known.
 */
export const playerState = { status: 'loading', offlineUri: null, error: '' };

function set(status) {
  playerState.status = status;
  onChange();
}

export function initPlayer(videoEl, changed) {
  video = videoEl;
  onChange = changed;
  // Locked down in markup too; set again so nothing can re-enable them.
  video.controls = false;
  video.autoplay = false;
  video.playsInline = true;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;

  video.addEventListener('play', () => {
    if (!authorized) video.pause(); // safety net: play outside the PIN flow
  });
  video.addEventListener('playing', () => {
    if (authorized) set('playing');
  });
  video.addEventListener('pause', () => {
    authorized = false;
    if (playerState.status === 'playing') set('paused');
  });
  video.addEventListener('ended', () => {
    authorized = false;
    set('ended');
  });
}

async function shakaPlayer() {
  if (!player) {
    player = new shaka.Player();
    await player.attach(video);
  }
  return player;
}

// Load into Shaka, paused at 0:00; uriFor() gives what to load. True if loaded.
// Leaving the video meanwhile, or failing, gives a falsy result.
async function load(offlineUri, uriFor) {
  await closing;
  if (playerState.offlineUri !== offlineUri) return;
  try {
    const p = await shakaPlayer();
    // Leaving the video meanwhile makes Shaka stop this load (it throws), so a
    // finished load is always for the video still open.
    await p.load(await uriFor(), 0);
    video.pause();
    video.currentTime = 0;
    return true;
  } catch (e) {
    // Opening can fail after the viewer has already left this video; only a race
    // in time reaches that, which the scenarios can't hold without waiting (owner OK).
    // v8 ignore next
    if (playerState.offlineUri !== offlineUri) return false;
    playerState.error = e.userMessage ?? '';
    set('error');
    return false;
  }
}

/**
 * Open a video, paused at 0:00. Never plays. uriFor() gives what to load (a
 * streamed video reads Google Drive); with later, loading waits for play.
 */
export async function openVideo(offlineUri, exists, uriFor = async () => offlineUri, later = false) {
  authorized = false;
  loadLater = null;
  playerState.offlineUri = offlineUri;
  playerState.error = '';
  if (!exists) return set('error');
  if (later) {
    loadLater = () => load(offlineUri, uriFor);
    return set('paused');
  }
  set('loading');
  if (await load(offlineUri, uriFor)) set('paused');
}

/** Leaving the player: stop and unload, so nothing keeps playing. */
export function closeVideo() {
  authorized = false;
  playerState.offlineUri = null;
  video?.pause();
  closing = (async () => {
    if (player) await player.unload();
    if (playerState.offlineUri == null) playerState.status = 'loading';
  })();
  return closing;
}

/** Play was requested (button or OS command): the PIN comes first. */
export function requestPlay() {
  if (!['paused', 'ended', 'time-up'].includes(playerState.status)) return false;
  set('pin-required');
  return true;
}

export function cancelPlay() {
  set('paused');
}

/**
 * The correct PIN was entered: start (or resume) playback. ready, if given, is
 * waited for first (a Google sign-in for a streamed video).
 */
export async function allowPlay(ready) {
  if (playerState.status !== 'pin-required') return;
  if (ready) {
    set('loading');
    try {
      await ready;
    } catch (e) {
      playerState.error = e.message;
      return set('error');
    }
    if (loadLater && !(await loadLater())) return;
    loadLater = null;
  }
  if (video.ended) video.currentTime = 0;
  authorized = true;
  try {
    await video.play();
  } catch {
    authorized = false;
    set('paused');
  }
}

/** Seek (M8). Never starts playback: free for the child, no PIN needed. */
export function seekTo(seconds) {
  if (!video || !Number.isFinite(video.duration)) return;
  video.currentTime = Math.max(0, Math.min(video.duration, seconds));
  // Seeking back from the end makes it a normal paused video again.
  if (playerState.status === 'ended' && video.currentTime < video.duration) set('paused');
}
export const seekBy = (delta) => video && seekTo(video.currentTime + delta);

/** An optional feature (watch-time limit) says playing must stop now. */
export function timeUp() {
  authorized = false;
  set('time-up'); // set first, so the pause event doesn't turn it into 'paused'
  video.pause();
}

export function pause() {
  video.pause();
  if (['playing', 'pin-required'].includes(playerState.status)) set('paused');
}
