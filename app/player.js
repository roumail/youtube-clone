// The player: Shaka on our own <video>, custom controls only.
// Pause is free; playback only ever starts through allowPlay() (after the PIN).
// Anything else that starts playback (script, OS media keys, browser quirks)
// is paused immediately.

let player;
let video;
let authorized = false; // true only between allowPlay() and the next pause/end
let onChange;
let closing = Promise.resolve(); // a pending closeVideo(); opening waits for it

/** status: 'loading' | 'paused' | 'pin-required' | 'playing' | 'ended' | 'time-up' | 'error' */
export const playerState = { status: 'loading', offlineUri: null };

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

/** Load a stored video, paused at 0:00. Never plays. */
export async function openVideo(offlineUri, exists) {
  authorized = false;
  playerState.offlineUri = offlineUri;
  if (!exists) return set('error');
  set('loading');
  await closing;
  if (playerState.offlineUri !== offlineUri) return;
  try {
    const p = await shakaPlayer();
    await p.load(offlineUri, 0);
    if (playerState.offlineUri !== offlineUri) return; // navigated away meanwhile
    video.pause();
    video.currentTime = 0;
    set('paused');
  } catch {
    if (playerState.offlineUri === offlineUri) set('error');
  }
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

/** The correct PIN was entered: start (or resume) playback. */
export async function allowPlay() {
  if (playerState.status !== 'pin-required') return;
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
